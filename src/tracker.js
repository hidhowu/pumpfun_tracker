import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import { RpcPool } from "./rpcPool.js";
import { LogSubscriber } from "./logSubscriber.js";
import { parseTransaction } from "./parseTransaction.js";
import { extractPumpTrades } from "./extractPumpTrades.js";
import { config } from "./env.js";
import { connectDb } from "../db/connect.js";
import { Trader } from "../db/models/Trader.js";
import { recordTrade } from "../db/positionLedger.js";
import { addTradersBulk } from "../db/traderService.js";
import { evaluateRealTrade } from "../db/simulation/engine.js";
import {
  processDuePendingExecutions,
  checkRiskExits,
} from "../db/simulation/executor.js";
import { ensureTodaySnapshotsForAllActiveTraders } from "../db/simulation/snapshot.js";
import { getGlobalSettings } from "../db/models/GlobalSettings.js";

function deriveWsFromHttp(rpcUrls) {
  return rpcUrls.map((u) => u.replace(/^http/, "ws"));
}

/**
 * Wires log tracking -> transaction parsing -> pump.fun trade extraction ->
 * MongoDB persistence into one reusable service. Each stage is its own
 * module (RpcPool, LogSubscriber, parseTransaction, extractPumpTrades,
 * db/positionLedger) so any of them can be swapped or reused independently
 * elsewhere in the app.
 *
 * Which addresses get watched is driven by MongoDB (the `Trader` collection
 * with status "active") via startDbSync(), polled on an interval - not by
 * change streams, since those need a replica-set MongoDB and a plain local
 * install is standalone. watch()/unwatch() are still available directly for
 * ad-hoc use without a DB (e.g. the CLI's plain-address mode).
 *
 * Events emitted: "connected", "disconnected", "watching", "unwatched",
 * "failedTx" ({address, signature, err}), "parsed" ({address, parsed}),
 * "parseError" ({address, signature, error}), "trade" (see
 * extractPumpTrades.js for the shape), "dbError", "error".
 */
export class TrackerService extends EventEmitter {
  constructor({
    rpcUrls = config.rpcUrls,
    wsUrls = config.wsUrls,
    commitment = config.commitment,
  } = {}) {
    super();
    this.rpcPool = new RpcPool(rpcUrls);
    this.subscriber = new LogSubscriber(
      wsUrls.length ? wsUrls : deriveWsFromHttp(rpcUrls),
      { commitment },
    );
    // Bounded set to dedupe the (rare) case of a duplicate notification for
    // the same signature without growing unbounded over a long-running process.
    this.seenSignatures = new Set();
    this.maxSeen = 5000;
    this._dbSyncTimer = null;
    this._executionTimer = null;
    this._riskTimer = null;
    this._riskLoopActive = false;
    this._snapshotTimer = null;

    this.subscriber.on("signature", (evt) => this._handleSignature(evt));
    this.subscriber.on("error", (err) => this.emit("error", err));
    this.subscriber.on("connected", (url) => this.emit("connected", url));
    this.subscriber.on("disconnected", (url) => this.emit("disconnected", url));
    this.subscriber.on("resubscribing", (count) => this.emit("resubscribing", count));
    this.subscriber.on("watching", (address) => this.emit("watching", address));
    this.subscriber.on("unwatched", (address) =>
      this.emit("unwatched", address),
    );
  }

  async watch(address) {
    return this.subscriber.watch(address);
  }

  async unwatch(address) {
    return this.subscriber.unwatch(address);
  }

  watchedAddresses() {
    return this.subscriber.watchedAddresses();
  }

  /** One pass: make the watched set match Trader{status:"active"} in Mongo. */
  async syncWatchedFromDb() {
    await connectDb();
    const traders = await Trader.find(
      { status: "active" },
      { address: 1 },
    ).lean();
    const desired = new Set(traders.map((t) => t.address));
    const current = new Set(this.watchedAddresses());

    for (const address of desired) {
      if (!current.has(address)) {
        await this.watch(address).catch((err) => this.emit("error", err));
        // Small stagger so subscribing to many new addresses at once (e.g.
        // a bulk add) doesn't burst past a provider's requests-per-second cap.
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    for (const address of current) {
      if (!desired.has(address)) {
        await this.unwatch(address).catch((err) => this.emit("error", err));
      }
    }
  }

  /** Starts polling Mongo for trader add/blacklist/unblacklist changes. */
  startDbSync(intervalMs = 15000) {
    this.syncWatchedFromDb().catch((err) => this.emit("error", err));
    this._dbSyncTimer = setInterval(() => {
      this.syncWatchedFromDb().catch((err) => this.emit("error", err));
    }, intervalMs);
  }

  stopDbSync() {
    if (this._dbSyncTimer) {
      clearInterval(this._dbSyncTimer);
      this._dbSyncTimer = null;
    }
  }

  /**
   * Starts the three background loops the copy-trade simulation needs:
   *  - fill queued buys/sells once their execution delay has elapsed
   *  - check every open position against its trader's stop-loss/take-profit/bench
   *  - make sure today's UTC daily-P&L snapshot exists for every active trader
   */
  startSimulationLoops({ executionIntervalMs = 2000, snapshotIntervalMs = 3600000 } = {}) {
    ensureTodaySnapshotsForAllActiveTraders().catch((err) => this.emit("error", err));

    this._executionTimer = setInterval(() => {
      processDuePendingExecutions().catch((err) => this.emit("error", err));
    }, executionIntervalMs);

    this._riskLoopActive = true;
    this._runRiskCheckLoop();

    this._snapshotTimer = setInterval(() => {
      ensureTodaySnapshotsForAllActiveTraders().catch((err) => this.emit("error", err));
    }, snapshotIntervalMs);
  }

  /**
   * Self-rescheduling (not setInterval) specifically so the interval can be
   * changed live from Settings (GlobalSettings.riskCheckIntervalSeconds) -
   * each cycle re-reads it before scheduling the next one, so a change
   * takes effect on the very next tick, no daemon restart needed.
   */
  async _runRiskCheckLoop() {
    if (!this._riskLoopActive) return;
    try {
      const count = await checkRiskExits();
      if (count > 0) this.emit("riskExitTriggered", count);
    } catch (err) {
      this.emit("error", err);
    }
    if (!this._riskLoopActive) return;

    let intervalSeconds = 20;
    try {
      const settings = await getGlobalSettings();
      intervalSeconds = Math.max(5, settings.riskCheckIntervalSeconds || 20);
    } catch (err) {
      this.emit("error", err);
    }
    this._riskTimer = setTimeout(() => this._runRiskCheckLoop(), intervalSeconds * 1000);
  }

  stopSimulationLoops() {
    this._riskLoopActive = false;
    if (this._riskTimer) clearTimeout(this._riskTimer);
    this._riskTimer = null;
    for (const timer of [this._executionTimer, this._snapshotTimer]) {
      if (timer) clearInterval(timer);
    }
    this._executionTimer = null;
    this._snapshotTimer = null;
  }

  async _handleSignature({ address, signature, err }) {
    if (err) {
      this.emit("failedTx", { address, signature, err });
      return;
    }
    if (this.seenSignatures.has(signature)) return;
    this.seenSignatures.add(signature);
    if (this.seenSignatures.size > this.maxSeen) {
      this.seenSignatures.delete(this.seenSignatures.values().next().value);
    }

    try {
      const parsed = await parseTransaction(signature, this.rpcPool);
      this.emit("parsed", { address, parsed });
      const trades = extractPumpTrades(parsed, { forAddress: address });
      for (const trade of trades) {
        try {
          const isNew = await recordTrade(trade);
          if (isNew) await evaluateRealTrade(trade);
        } catch (dbErr) {
          this.emit("dbError", { address, signature, error: dbErr });
        }
        this.emit("trade", trade);
      }
    } catch (error) {
      this.emit("parseError", { address, signature, error });
    }
  }

  close() {
    this.stopDbSync();
    this.stopSimulationLoops();
    this.subscriber.close();
  }
}

async function runCli() {
  await connectDb();

  const seedAddresses = [...config.trackedAddresses, ...process.argv.slice(2)];
  if (seedAddresses.length > 0) {
    const { added, skipped, invalid } = await addTradersBulk(seedAddresses);
    if (added.length)
      console.log(`[tracker] seeded new traders: ${added.join(", ")}`);
    if (skipped.length)
      console.log(`[tracker] already tracked, skipped: ${skipped.join(", ")}`);
    if (invalid.length)
      console.error(`[tracker] not valid Solana addresses, ignored: ${invalid.join(", ")}`);
  }

  const tracker = new TrackerService();
  tracker.on("connected", (url) => console.log(`[tracker] connected: ${url}`));
  tracker.on("disconnected", (url) =>
    console.log(`[tracker] disconnected: ${url} - reconnecting...`),
  );
  tracker.on("resubscribing", (count) =>
    console.log(`[tracker] reconnected - resubscribing to ${count} address(es)`),
  );
  tracker.on("error", (err) =>
    console.error("[tracker] error:", err.message || err),
  );
  tracker.on("watching", (address) =>
    console.log(`[tracker] watching ${address}`),
  );
  tracker.on("unwatched", (address) =>
    console.log(`[tracker] stopped watching ${address}`),
  );
  tracker.on("failedTx", ({ address, signature }) =>
    console.log(
      `[tracker] ${address} - tx failed on-chain, skipping: ${signature}`,
    ),
  );
  tracker.on("parseError", ({ signature, error }) =>
    console.error(`[tracker] failed to parse ${signature}: ${error.message}`),
  );
  tracker.on("dbError", ({ signature, error }) =>
    console.error(
      `[tracker] failed to persist trade for ${signature}: ${error.message}`,
    ),
  );
  tracker.on("riskExitTriggered", (count) =>
    console.log(`[tracker] risk-exit (stop-loss/take-profit/bench) closed ${count} position(s)`),
  );
  tracker.on("trade", (trade) => {
    console.log(
      `[trade] ${trade.type.toUpperCase()} wallet=${trade.wallet} mint=${trade.mint} ` +
        `tokens=${trade.tokenAmount} sol=${trade.solAmount}(${trade.solAmountSource}) sig=${trade.signature}`,
    );
  });

  console.log(
    "[tracker] watch list is driven by MongoDB (Trader collection, status=active), polled every 15s.",
  );
  tracker.startDbSync(15000);
  tracker.startSimulationLoops();
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((err) => {
    console.error("[tracker] fatal:", err.message || err);
    process.exit(1);
  });
}
