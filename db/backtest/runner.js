import os from "node:os";
import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { BacktestTx } from "../models/BacktestTx.js";
import { BacktestAddress } from "../models/BacktestAddress.js";
import { BacktestSettings } from "../models/BacktestSettings.js";
import { logEvent } from "../systemLog.js";
import { resolveBacktestSettings } from "./settings.js";
import { BacktestRpcPool } from "./rpcPool.js";
import { PumpTradesClient, EmptyPageError } from "./pumpTradesClient.js";
import { PositionScheduler } from "./positionScheduler.js";
import { collectAddress, StopRequested, SignatureLimitExceeded } from "./collector.js";
import { collectAddressViaApi } from "./apiCollector.js";
import { groupTradesByMint, listSignals, findTraderSell } from "./signals.js";
import { simulatePosition, UnresolvedError } from "./simulator.js";
import { EarlyStopError, evaluateEarlyStop, hasEarlyStop } from "./earlyStop.js";
import { sleep } from "./slotPool.js";

const TICK_MS = 2000;
const LEASE_MS = 60_000;
// "Addresses at once" = N means N addresses are served first and N more are collected and started on standby: when the front ones are
// waiting for their last trades of a day, the freed capacity goes to the standby ones' current day instead of racing ahead to a later day.
const STANDBY_FACTOR = 2;
const SIGNAL_RETRIES = 3;
const MEMO_BUCKET_SECONDS = 900;
const MEMO_REACH_BUCKETS = 24; // +-6h
// A trader buy this far below the dust threshold (by the remembered SOL/USD rate) is skipped without a network call.
const DUST_SHORTCUT_FACTOR = 0.9;

const SKIP_COUNTER = {
  dust: "dust",
  no_data: "noData",
  insufficient_balance: "insufficientBalance",
  unresolved: "unresolved",
  error: "error",
};

/** Buffers progress writes for one address so a fast loop doesn't hammer Mongo (one update per second at most). */
function progressWriter(runTraderId) {
  let pending = {};
  let timer = null;
  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const patch = pending;
    pending = {};
    if (Object.keys(patch).length > 0) await BacktestRunTrader.updateOne({ _id: runTraderId }, { $set: patch });
  };
  return {
    set(patch) {
      Object.assign(pending, patch);
      if (!timer) timer = setTimeout(() => flush().catch(() => {}), 1000);
    },
    flush,
  };
}

/** Remembers recent SOL/USD rates (derived from pool prices) so dust buys can be recognised without fetching anything. */
class UsdPerSolMemo {
  constructor() {
    this.buckets = new Map();
  }
  set(value, atSec) {
    this.buckets.set(Math.floor(atSec / MEMO_BUCKET_SECONDS), value);
    if (this.buckets.size > 2000) this.buckets.delete(this.buckets.keys().next().value);
  }
  estimate(atSec) {
    const base = Math.floor(atSec / MEMO_BUCKET_SECONDS);
    for (let d = 0; d <= MEMO_REACH_BUCKETS; d++) {
      const hit = this.buckets.get(base + d) ?? this.buckets.get(base - d);
      if (hit) return hit;
    }
    return null;
  }
}

export class BacktestWorker {
  constructor() {
    this.id = `${os.hostname()}:${process.pid}`;
    this.rpcPool = new BacktestRpcPool();
    this.pump = new PumpTradesClient();
    this.userTrades = new PumpTradesClient({ rpsSetting: "userTradesRps" }); // same proxies, paced for the user-trades endpoint
    this.memo = new UsdPerSolMemo();
    this.scheduler = new PositionScheduler(); // which position is simulated next, across ALL addresses (slots = settings.positionParallelism)
    this.launchSeq = 0; // claim order of addresses: the older one gets the free slots first
    this.active = new Map(); // `${runId}:${address}` -> promise
    this.runControl = new Map(); // runId -> "run" | "pause" | "cancel"
    this.runDaysAtOnce = new Map(); // runId -> days of one address worked at once (0 = no limit); refreshed every tick so an edit applies while running
    this.settingsCache = { at: 0, value: null };
    this.lastTickAt = Date.now();
    this.timer = null;
    this.stopping = false;
    this.ticking = false;
  }

  async start() {
    // One worker process owns every lease, so anything left over from a previous (crashed) process is free to take back.
    await BacktestRunTrader.updateMany({ claimedBy: { $ne: null } }, { $set: { claimedBy: null, leaseUntil: null } });
    logEvent("tracker", `[backtest] Backtest worker started (${this.id})`);
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error("[backtest] tick failed:", err.message || err));
    }, TICK_MS);
    this.tick().catch((err) => console.error("[backtest] tick failed:", err.message || err));
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.active.values()]);
  }

  async #settings() {
    if (Date.now() - this.settingsCache.at > 15_000) {
      this.settingsCache = { at: Date.now(), value: (await resolveBacktestSettings()).effective };
    }
    return this.settingsCache.value;
  }

  async tick() {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const elapsed = now - this.lastTickAt;
      this.lastTickAt = now;
      await BacktestSettings.updateOne({ key: "default" }, { $set: { workerHeartbeatAt: new Date(now), workerId: this.id } }, { upsert: true });

      const runs = await BacktestRun.find({ status: { $in: ["queued", "running", "paused"] } }).sort({ createdAt: 1 }).lean();
      this.runControl = new Map(runs.map((r) => [String(r._id), r.control]));
      this.runDaysAtOnce = new Map(runs.map((r) => [String(r._id), r.daysAtOnce || 0]));

      // ---- apply pause / cancel / resume requests
      for (const run of runs) {
        if (run.control === "cancel") {
          await BacktestRun.updateOne({ _id: run._id }, { $set: { status: "cancelled", finishedAt: new Date() } });
        } else if (run.control === "pause" && run.status !== "paused") {
          await BacktestRun.updateOne({ _id: run._id }, { $set: { status: "paused" } });
        }
      }
      const live = runs.filter((r) => r.control === "run");

      // ---- keep leases of running work alive, and count working time
      if (this.active.size > 0) {
        await BacktestRunTrader.updateMany(
          { claimedBy: this.id, stage: { $in: ["pending", "collecting", "simulating"] } },
          { $set: { leaseUntil: new Date(now + LEASE_MS) } }
        );
      }
      const workingRunIds = new Set([...this.active.keys()].map((k) => k.split(":")[0]));
      for (const run of live) {
        if (workingRunIds.has(String(run._id))) {
          await BacktestRun.updateOne({ _id: run._id }, { $inc: { activeMs: elapsed } });
        }
      }

      // ---- claim more addresses up to the parallelism limit, oldest run first
      const settings = await this.#settings();
      // A run with its own "addresses at once" keeps that many addresses at the front plus as many again on standby (see STANDBY_FACTOR);
      // the others share the worker's automatic number.
      const activeBy = new Map();
      for (const k of this.active.keys()) activeBy.set(k.split(":")[0], (activeBy.get(k.split(":")[0]) ?? 0) + 1);
      const ownRuns = new Set(live.filter((r) => r.addressParallelism > 0).map((r) => String(r._id)));
      let sharedFree = settings.addressParallelism - [...activeBy].filter(([id]) => !ownRuns.has(id)).reduce((n, [, c]) => n + c, 0);
      for (const run of live) {
        const own = ownRuns.has(String(run._id));
        let free = own ? run.addressParallelism * STANDBY_FACTOR - (activeBy.get(String(run._id)) ?? 0) : sharedFree;
        while (free > 0) {
          const rt = await BacktestRunTrader.findOneAndUpdate(
            {
              runId: run._id,
              stage: { $in: ["pending", "collecting", "simulating"] },
              $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }],
            },
            { $set: { claimedBy: this.id, leaseUntil: new Date(Date.now() + LEASE_MS) } },
            { sort: { _id: 1 }, returnDocument: "after" }
          );
          if (!rt) break;
          if (run.status !== "running") {
            await BacktestRun.updateOne({ _id: run._id }, { $set: { status: "running", startedAt: run.startedAt ?? new Date() } });
            run.status = "running";
          }
          this.#launch(run, rt);
          free -= 1;
          if (!own) sharedFree -= 1;
        }
      }

      // ---- finish runs whose addresses are all settled
      for (const run of live) {
        const remaining = await BacktestRunTrader.countDocuments({ runId: run._id, stage: { $in: ["pending", "collecting", "simulating"] } });
        if (remaining > 0) continue;
        const done = await BacktestRunTrader.countDocuments({ runId: run._id, stage: "done" });
        const failed = await BacktestRunTrader.countDocuments({ runId: run._id, stage: "failed" });
        const skippedCount = await BacktestRunTrader.countDocuments({ runId: run._id, stage: "skipped" });
        await BacktestRun.updateOne(
          { _id: run._id, status: { $in: ["queued", "running"] } },
          {
            $set: {
              status: done === 0 && failed > 0 ? "failed" : "completed",
              finishedAt: new Date(),
              error: failed > 0 ? `${failed} address(es) failed - see their errors` : null,
              startedAt: run.startedAt ?? new Date(),
            },
          }
        );
        logEvent("tracker", `[backtest] Backtest "${run.name}" finished (${done} done, ${failed} failed, ${skippedCount} skipped)`);
      }
    } finally {
      this.ticking = false;
    }
  }

  #launch(run, rt) {
    const key = `${run._id}:${rt.address}`;
    const order = this.launchSeq++;
    const task = this.#processAddress(run, rt, order)
      .catch((err) => console.error(`[backtest] ${key} crashed:`, err))
      .finally(() => {
        this.active.delete(key);
        // Take the next address right away instead of leaving the freed place empty until the next tick.
        this.tick().catch((err) => console.error("[backtest] tick failed:", err.message || err));
      });
    this.active.set(key, task);
  }

  #shouldStop(runId) {
    return this.stopping || this.runControl.get(String(runId)) !== "run";
  }

  async #processAddress(run, rt, order) {
    const runId = String(run._id);
    const shouldStop = () => this.#shouldStop(runId);
    const writer = progressWriter(rt._id);
    const settings = await this.#settings();
    const windowStartSec = Math.floor(run.windowStart.getTime() / 1000);
    const windowEndSec = Math.floor(run.windowEnd.getTime() / 1000);
    if (!rt.startedAt) await BacktestRunTrader.updateOne({ _id: rt._id }, { $set: { startedAt: new Date() } });

    try {
      if (!rt.collect?.done) {
        await BacktestRunTrader.updateOne({ _id: rt._id }, { $set: { stage: "collecting", error: null } });
        // Trades come straight from pump.fun (fast). The endpoint takes the wallet address when there is no user id, so every address can use it;
        // reading the chain over RPC (slow) is only the fallback for an address the endpoint keeps answering blank pages for.
        const userId = rt.userId || (await BacktestAddress.findOne({ address: rt.address }, { userId: 1 }).lean())?.userId || "";
        const common = {
          address: rt.address,
          windowStartSec,
          windowEndSec,
          shouldStop,
          progress: (patch) => writer.set(patch),
          maxSignatures: run.maxSignatures || 0,
        };
        let result;
        try {
          result = await collectAddressViaApi({ ...common, userId, client: this.userTrades });
        } catch (err) {
          if (!(err instanceof EmptyPageError)) throw err;
          logEvent("tracker", `[backtest] ${rt.address}: pump.fun kept answering blank pages, reading the chain over RPC instead`, { meta: { runId, address: rt.address } });
          writer.set({ "collect.source": "rpc" });
          result = await collectAddress({ ...common, rpcPool: this.rpcPool, txConcurrency: settings.txParallelismPerAddress });
        }
        const { failed } = result;
        await writer.flush();
        await BacktestRunTrader.updateOne(
          { _id: rt._id },
          { $set: { "collect.done": true, "collect.signaturesFailed": failed } }
        );
      }

      if (!rt.sim?.done) {
        await BacktestRunTrader.updateOne({ _id: rt._id }, { $set: { stage: "simulating" } });
        await this.#simulateAddress({ run, rt, settings, windowStartSec, windowEndSec, writer, shouldStop, order });
        await writer.flush();
      }

      await BacktestRunTrader.updateOne(
        { _id: rt._id },
        { $set: { stage: "done", "sim.done": true, finishedAt: new Date(), claimedBy: null, leaseUntil: null } }
      );
    } catch (err) {
      await writer.flush().catch(() => {});
      if (err instanceof StopRequested) {
        // Paused/cancelled/shutting down - give the address back untouched; progress made so far is kept.
        await BacktestRunTrader.updateOne({ _id: rt._id }, { $set: { claimedBy: null, leaseUntil: null } });
        return;
      }
      if (err instanceof EarlyStopError) {
        // Assumed a loss trader: stop here and keep what was simulated so far. Shown as skipped, with the reason.
        logEvent("tracker", `[backtest] Backtest address ${rt.address}: ${err.message}`, { meta: { runId, address: rt.address, reason: err.reason } });
        await BacktestRunTrader.updateOne(
          { _id: rt._id },
          { $set: { stage: "skipped", stopReason: err.reason, error: err.message, finishedAt: new Date(), claimedBy: null, leaseUntil: null } }
        );
        return;
      }
      if (err instanceof SignatureLimitExceeded) {
        // Too busy an address for this backtest's limit - a deliberate skip, not a failure.
        logEvent("tracker", `[backtest] Backtest address ${rt.address} skipped: ${err.message}`, { meta: { runId, address: rt.address } });
        await BacktestRunTrader.updateOne(
          { _id: rt._id },
          { $set: { stage: "skipped", error: err.message, finishedAt: new Date(), claimedBy: null, leaseUntil: null } }
        );
        return;
      }
      const message = (err && err.message) || String(err);
      logEvent("tracker", `[backtest] Backtest address ${rt.address} failed: ${message}`, { level: "error", meta: { runId, address: rt.address } });
      await BacktestRunTrader.updateOne(
        { _id: rt._id },
        { $set: { stage: "failed", error: message.slice(0, 500), finishedAt: new Date(), claimedBy: null, leaseUntil: null } }
      );
    }
  }

  async #simulateAddress({ run, rt, settings, windowStartSec, windowEndSec, writer, shouldStop, order }) {
    const strategy = run.settings;
    const address = rt.address;
    const runId = String(run._id);

    const txs = await BacktestTx.find(
      { address, blockTime: { $gte: windowStartSec, $lte: windowEndSec } },
      { signature: 1, blockTime: 1, slot: 1, ix: 1, trades: 1 }
    ).lean();
    const byMint = groupTradesByMint(txs);
    const signals = listSignals(byMint);
    const tradeCount = [...byMint.values()].reduce((n, e) => n + e.buys.length + e.sells.length, 0);

    // What an earlier (interrupted) pass already settled.
    const existing = await BacktestPosition.find({ runId: run._id, address }).lean();
    const settled = new Map(existing.map((p) => [p.mint, p]));
    const skipped = { dust: 0, noData: 0, insufficientBalance: 0, unresolved: 0, error: 0 };
    for (const p of existing) if (p.status === "skipped") skipped[SKIP_COUNTER[p.skipReason] ?? "error"] += 1;
    let signalsDone = signals.filter((s) => settled.has(s.mint)).length;

    const publish = () =>
      writer.set({
        "collect.tradesFound": tradeCount,
        "sim.signalsTotal": signals.length,
        "sim.signalsDone": signalsDone,
        "sim.skipped.dust": skipped.dust,
        "sim.skipped.noData": skipped.noData,
        "sim.skipped.insufficientBalance": skipped.insufficientBalance,
        "sim.skipped.unresolved": skipped.unresolved,
        "sim.skipped.error": skipped.error,
      });
    publish();

    // ---- balance ledger (only enforced when the profile forbids a negative balance). In a combined backtest the wallet is shared by every
    // address, so no address can judge its own balance: it simulates every trade and the shared wallet is worked out afterwards (combined.js).
    const combined = run.mode === "combined";
    const enforceBalance = !combined && strategy.allowNegativeBalance === false;
    const events = []; // { at, delta }
    for (const p of existing) {
      if (p.status === "skipped" || !p.openedAt) continue;
      events.push({ at: Math.floor(p.openedAt.getTime() / 1000), delta: -((p.costBasisUsd || 0) + (p.buyFeeUsd || 0)) });
      if (p.status === "closed" && p.closedAt) events.push({ at: Math.floor(p.closedAt.getTime() / 1000), delta: (p.proceedsUsd || 0) - (p.sellFeeUsd || 0) });
    }
    const startingBalance = strategy.allocationUsd ?? 100;
    const canOpen = (atSec, outlay) => {
      const balance = startingBalance + events.filter((e) => e.at <= atSec).reduce((sum, e) => sum + e.delta, 0);
      return balance >= outlay;
    };

    // ---- "everything before here is simulated" marker: signals finish out of order, this tracks the contiguous prefix
    const finished = new Array(signals.length).fill(false);
    signals.forEach((s, i) => {
      if (settled.has(s.mint)) finished[i] = true;
    });
    let prefix = 0;
    let throughMs = 0; // everything before this instant is simulated - what the early-stop rules treat as final
    const advance = () => {
      while (prefix < signals.length && finished[prefix]) prefix += 1;
      const through = prefix >= signals.length ? new Date(windowEndSec * 1000) : new Date(signals[prefix].buys[0].blockTime * 1000);
      throughMs = through.getTime();
      writer.set({ "sim.simulatedThrough": through });
    };
    advance();

    // ---- early stop: a trader that is clearly losing is dropped (see earlyStop.js). Checked before any work and after every position.
    const rules = combined ? null : run.earlyStop; // one address dropping out would change the wallet the others share
    let halted = null;
    const stopNow = () => shouldStop() || halted !== null;
    const checkEarlyStop = () => {
      if (halted || !hasEarlyStop(rules)) return;
      const closed = [];
      const cashEvents = [];
      for (const p of settled.values()) {
        if (p.status === "skipped" || !p.openedAt) continue;
        cashEvents.push({ t: new Date(p.openedAt).getTime(), delta: -((p.costBasisUsd || 0) + (p.buyFeeUsd || 0)), order: 1 });
        if (p.status === "closed" && p.closedAt) {
          const t = new Date(p.closedAt).getTime();
          closed.push({ closedAtMs: t, pnlUsd: p.realizedPnlUsd || 0, pnlPercent: p.realizedPnlPercent || 0 });
          cashEvents.push({ t, delta: (p.proceedsUsd || 0) - (p.sellFeeUsd || 0), order: 0 });
        }
      }
      const hit = evaluateEarlyStop(rules, { closed, cashEvents, startingUsd: startingBalance, throughMs, signalsDone, signalsTotal: signals.length });
      if (hit) halted = new EarlyStopError(hit.reason, hit.message);
    };
    checkEarlyStop();

    const processSignal = async (index) => {
      const sig = signals[index];
      if (settled.has(sig.mint)) return;
      if (stopNow()) throw new StopRequested();

      let doc = null;
      for (let attempt = 1; attempt <= SIGNAL_RETRIES; attempt++) {
        try {
          doc = await this.#evaluateSignal({ run, sig, settings, strategy, windowEndSec, canOpen: enforceBalance ? canOpen : null, shouldStop: stopNow });
          break;
        } catch (err) {
          if (err instanceof StopRequested) throw err;
          if (err instanceof UnresolvedError) {
            doc = { status: "skipped", skipReason: "unresolved" };
            break;
          }
          if (attempt === SIGNAL_RETRIES) doc = { status: "skipped", skipReason: "error", errorMessage: (err.message || "").slice(0, 200) };
          else await sleep(3000 * attempt);
        }
      }

      const row = { runId: run._id, address, mint: sig.mint, signalTime: sig.buys[0].blockTime, ...doc };
      delete row.errorMessage;
      await BacktestPosition.updateOne({ runId: run._id, address, mint: sig.mint }, { $set: row }, { upsert: true });
      settled.set(sig.mint, row);

      if (row.status === "skipped") skipped[SKIP_COUNTER[row.skipReason] ?? "error"] += 1;
      else if (row.openedAt) {
        events.push({ at: Math.floor(row.openedAt.getTime() / 1000), delta: -((row.costBasisUsd || 0) + (row.buyFeeUsd || 0)) });
        if (row.status === "closed") events.push({ at: Math.floor(row.closedAt.getTime() / 1000), delta: (row.proceedsUsd || 0) - (row.sellFeeUsd || 0) });
      }
      signalsDone += 1;
      finished[index] = true;
      publish();
      advance();
      checkEarlyStop();
    };

    // ---- hand the positions to the shared scheduler, one day at a time (see positionScheduler.js).
    // `dayOf[i]` counts the distinct UTC days that have a position: the position's day is the day of its first buy, the same day the
    // early-stop rules treat as complete once everything before it is simulated.
    const dayOf = [];
    let lastDay = null;
    let dayNo = -1;
    for (const s of signals) {
      const d = Math.floor(s.buys[0].blockTime / 86400);
      if (d !== lastDay) {
        lastDay = d;
        dayNo += 1;
      }
      dayOf.push(dayNo);
    }

    const started = signals.map((s) => settled.has(s.mint));
    const maxInFlight = enforceBalance ? 1 : Infinity; // a profile that forbids a negative balance has to go position by position
    let cursor = 0; // first position not handed out yet
    let inFlight = 0;
    let failure = null;
    let finishedSource = false;
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const nothingLeft = () => {
      while (cursor < signals.length && started[cursor]) cursor += 1;
      return cursor >= signals.length;
    };

    const source = {
      order,
      settle: () => {
        if (finishedSource || inFlight > 0) return;
        if (failure) {
          finishedSource = true;
          rejectDone(failure);
        } else if (nothingLeft() || halted) {
          finishedSource = true;
          resolveDone();
        } else if (shouldStop()) {
          finishedSource = true;
          rejectDone(new StopRequested());
        }
      },
      claim: (lookAhead) => {
        if (finishedSource || failure || stopNow() || inFlight >= maxInFlight || nothingLeft()) return null;
        // `prefix` is the first position not finished, so its day is the day being worked on. With a limit of N days at once, the first N days
        // are served normally and the day after them only with capacity nothing else wanted; 0 = no limit.
        const daysAtOnce = this.runDaysAtOnce.get(runId) ?? run.daysAtOnce ?? 0;
        if (daysAtOnce > 0 && dayOf[cursor] - dayOf[prefix] > (lookAhead ? daysAtOnce : daysAtOnce - 1)) return null;
        const index = cursor++;
        started[index] = true;
        inFlight += 1;
        return {
          run: async () => {
            try {
              await processSignal(index);
            } catch (err) {
              if (!(halted && err instanceof StopRequested) && !failure) failure = err; // the abort that came from the early stop itself is not a failure
            } finally {
              inFlight -= 1;
            }
          },
        };
      },
    };

    this.scheduler.setLimit(settings.positionParallelism);
    this.scheduler.add(source);
    try {
      await done;
    } finally {
      this.scheduler.remove(source);
    }
    await writer.flush();
    if (halted && !finished.every(Boolean)) throw halted;
  }

  /** Works through a token's buys oldest-first until one is a real (non-dust) buy, and simulates it. Returns a BacktestPosition-shaped object. */
  async #evaluateSignal({ run, sig, settings, strategy, windowEndSec, canOpen, shouldStop }) {
    const delay = Math.max(0, strategy.executionDelaySeconds ?? 2);
    const budget = { pages: 0 };
    const api = {
      fetchRange: async (mint, from, to) => {
        if (shouldStop()) throw new StopRequested();
        const res = await this.pump.fetchRange(mint, from, to, { maxPages: Math.max(1, settings.maxPagesPerPosition - budget.pages) });
        budget.pages += res.pages;
        if (res.truncated || budget.pages >= settings.maxPagesPerPosition) throw new UnresolvedError("too many trades to resolve this position");
        return res;
      },
    };

    for (const buy of sig.buys) {
      // Cheap dust check from a remembered SOL/USD rate, before spending any request on it.
      const rate = this.memo.estimate(buy.blockTime);
      if (rate != null && buy.solAmount != null && buy.solAmount * rate < strategy.dustBuyUsd * DUST_SHORTCUT_FACTOR) continue;

      const fillSec = buy.blockTime + delay;
      const traderSell = findTraderSell({
        buys: sig.buys,
        sells: sig.sells,
        buy,
        fillTimeSec: fillSec,
        dustSellFractionPercent: strategy.dustSellFractionPercent ?? 10,
      });

      const res = await simulatePosition({
        mint: sig.mint,
        buy,
        traderSell,
        settings: strategy,
        windowEndSec,
        api,
        initialWindow: settings.initialWindowSeconds,
        onUsdPerSol: (value, atSec) => this.memo.set(value, atSec),
        canOpen,
      });
      if (res.outcome === "dust") continue;
      return this.#toPositionDoc(buy, res);
    }
    return { status: "skipped", skipReason: "dust" };
  }

  #toPositionDoc(buy, res) {
    if (res.outcome === "skipped") return { status: "skipped", skipReason: res.reason };
    const common = {
      traderBuySignature: buy.signature,
      traderBuyTime: buy.blockTime,
      traderBuySol: buy.solAmount,
      traderBuyUsd: res.traderBuyUsd,
      traderSellSignature: res.traderSellSignature ?? null,
      traderSellTime: res.traderSellTime ?? null,
      openedAt: new Date(res.openedAtSec * 1000),
      buyPriceUsd: res.buyPriceUsd,
      buyPriceSource: res.buyPriceSource,
      tokenAmount: res.tokenAmount,
      costBasisUsd: res.costBasisUsd,
      buyFeeUsd: res.buyFeeUsd,
      maxUnrealizedPnlPercent: res.maxUnrealizedPnlPercent,
      minUnrealizedPnlPercent: res.minUnrealizedPnlPercent,
      tradesScanned: res.tradesScanned,
    };
    if (res.outcome === "open") {
      return {
        ...common,
        status: "open",
        markPriceUsd: res.markPriceUsd,
        unrealizedPnlUsd: res.unrealizedPnlUsd,
        unrealizedPnlPercent: res.unrealizedPnlPercent,
      };
    }
    return {
      ...common,
      status: "closed",
      closedAt: new Date(res.closedAtSec * 1000),
      closeSignalAt: new Date(res.closeSignalSec * 1000),
      closeReason: res.closeReason,
      sellPriceUsd: res.sellPriceUsd,
      proceedsUsd: res.proceedsUsd,
      sellFeeUsd: res.sellFeeUsd,
      realizedPnlUsd: res.realizedPnlUsd,
      realizedPnlPercent: res.realizedPnlPercent,
    };
  }
}
