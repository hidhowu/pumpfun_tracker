import { fileURLToPath } from "url";
import path from "path";
import { EventEmitter } from "events";
import { RpcPool } from "./rpcPool.js";
import { LogSubscriber } from "./logSubscriber.js";
import { parseTransaction } from "./parseTransaction.js";
import { extractPumpTrades } from "./extractPumpTrades.js";
import { config } from "./env.js";
import { connectDb } from "../db/connect.js";
import { Trader } from "../db/models/Trader.js";
import { RpcEndpoint } from "../db/models/RpcEndpoint.js";
import { recordTrade, markTradeActioned } from "../db/positionLedger.js";
import { addTradersBulk } from "../db/traderService.js";
import { evaluateRealTrade } from "../db/simulation/engine.js";
import {
  processDuePendingExecutions,
  checkRiskExits,
} from "../db/simulation/executor.js";
import { ensureTodaySnapshotsForAllActiveTraders } from "../db/simulation/snapshot.js";
import { getSystemSettings } from "../db/models/SystemSettings.js";
import { logEvent } from "../db/systemLog.js";
import { SystemCommand } from "../db/models/SystemCommand.js";
import { ensureRpcEndpointsSeeded, rebalanceAssignments, markSubscribed, markSubscriptionFailed } from "../db/rpcAssignment.js";

function deriveWsFromHttp(rpcUrls) {
  return rpcUrls.map((u) => u.replace(/^http/, "ws"));
}

// Gap between each address subscription, and how to back off when the
// provider starts rejecting them (RPS limit) - see _doSyncWatchedFromDb.
const WATCH_STAGGER_MS = 500;
const WATCH_FAILURE_BACKOFF_MS = 2000;
const WATCH_FAILURES_BEFORE_ABORT = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wires log tracking -> transaction parsing -> pump.fun trade extraction ->
 * MongoDB persistence into one reusable service. Each stage is its own
 * module (RpcPool, LogSubscriber, parseTransaction, extractPumpTrades,
 * db/positionLedger) so any of them can be swapped or reused independently
 * elsewhere in the app.
 *
 * Tracked addresses are spread across however many RPC WebSocket endpoints
 * are registered in the `RpcEndpoint` collection (managed from the /rpc UI)
 * - one `LogSubscriber` per active endpoint, each handling only the subset
 * of addresses assigned to it (see db/rpcAssignment.js for the sticky
 * load-balancer). This exists specifically because resubscribing ~90
 * addresses on a single connection blows through a single RPC provider's
 * requests-per-second limit - splitting across endpoints (ideally different
 * providers) relieves that. Which addresses get watched, and which endpoint
 * each lives on, is driven by MongoDB via startDbSync(), polled on an
 * interval - not by change streams, since those need a replica-set MongoDB
 * and a plain local install is standalone.
 *
 * Events emitted: "connected", "disconnected", "watching", "unwatched",
 * "failedTx" ({address, signature, err}), "parsed" ({address, parsed}),
 * "parseError" ({address, signature, error}), "trade" (see
 * extractPumpTrades.js for the shape), "dbError", "error".
 */
export class TrackerService extends EventEmitter {
  constructor({
    rpcUrls = config.rpcUrls,
    commitment = config.commitment,
  } = {}) {
    super();
    this.rpcPool = new RpcPool(rpcUrls);
    this.commitment = commitment;
    // url -> LogSubscriber, one per active RpcEndpoint - populated/torn down
    // by syncWatchedFromDb as RpcEndpoint documents are added/removed/toggled.
    this.subscribers = new Map();
    // Bounded set to dedupe the (rare) case of a duplicate notification for
    // the same signature without growing unbounded over a long-running process.
    this.seenSignatures = new Set();
    this.maxSeen = 5000;
    this._dbSyncTimer = null;
    this._executionTimer = null;
    this._riskTimer = null;
    this._riskLoopActive = false;
    this._snapshotTimer = null;
    this._commandTimer = null;
    this._syncInProgress = false;
  }

  /** Creates and wires a LogSubscriber dedicated to exactly one RPC endpoint. */
  _createSubscriber(url) {
    // A single-element URL array: LogSubscriber's own reconnect logic always
    // retries `this.wsUrls[this.urlIndex % this.wsUrls.length]`, which with
    // one element always resolves back to this same URL - it keeps retrying
    // *this* endpoint forever rather than hopping to a different one, which
    // is the semantic we want (each RpcEndpoint has its own identity/status).
    const sub = new LogSubscriber([url], { commitment: this.commitment });
    this._wireSubscriber(url, sub);
    this.subscribers.set(url, sub);
    return sub;
  }

  /** Closes and forgets a subscriber - only call after its addresses have been moved elsewhere. */
  _teardownSubscriber(url) {
    const sub = this.subscribers.get(url);
    if (!sub) return;
    sub.close(); // sets closedByUser, so its own auto-reconnect loop stops
    this.subscribers.delete(url);
  }

  _wireSubscriber(url, sub) {
    sub.on("signature", (evt) => this._handleSignature(evt));
    sub.on("error", (err) => {
      this.emit("error", err);
      logEvent("rpc", `RPC error (${url}): ${err.message || err}`, { level: "error", meta: { url } });
      RpcEndpoint.updateOne({ url }, { $set: { lastError: err.message || String(err), lastErrorAt: new Date() } }).catch(() => {});
    });
    sub.on("connected", () => {
      this.emit("connected", url);
      logEvent("rpc", `Connected: ${url}`, { meta: { url } });
      RpcEndpoint.updateOne({ url }, { $set: { status: "connected", lastConnectedAt: new Date() } }).catch(() => {});
    });
    sub.on("disconnected", () => {
      this.emit("disconnected", url);
      const retrySeconds = Math.round(sub.reconnectDelayMs / 1000);
      logEvent("rpc", `Disconnected: ${url} - retrying in ${retrySeconds}s`, {
        level: "warn",
        meta: { url, retryInMs: sub.reconnectDelayMs },
      });
      RpcEndpoint.updateOne({ url }, { $set: { status: "disconnected", lastDisconnectedAt: new Date() } }).catch(() => {});
      // Every address assigned to this endpoint was live a moment ago but
      // isn't anymore - without this, the /rpc page kept showing them as
      // "subscribed" (green) the whole time the connection was actually
      // down, since nothing had ever told the DB otherwise. They flip back
      // to "subscribed" on their own once "watching" fires again after
      // reconnect (see the "watching" handler below).
      Trader.updateMany({ assignedRpcUrl: url }, { $set: { subscriptionStatus: "pending" } }).catch((err) => this.emit("error", err));
    });
    sub.on("resubscribing", (count) => {
      this.emit("resubscribing", count);
      logEvent("rpc", `Reconnected (${url}) - resubscribing to ${count} address(es)`, { meta: { url } });
    });
    sub.on("watching", (address) => {
      this.emit("watching", address);
      logEvent("tracker", `Watching ${address}`, { meta: { address, url } });
      // The single source of truth for "this address is actually live" -
      // covers both an explicit watch() call AND automatic resubscription
      // after a reconnect (which calls the LogSubscriber directly, not
      // through TrackerService.watch() below), so a disconnect/reconnect
      // cycle always correctly flips addresses back to "subscribed" once
      // they're truly resubscribed, not just the addresses newly assigned
      // this poll cycle.
      markSubscribed(address, url).catch((err) => this.emit("error", err));
    });
    sub.on("unwatched", (address) => {
      this.emit("unwatched", address);
      logEvent("tracker", `Stopped watching ${address}`, { meta: { address, url } });
    });
  }

  /**
   * Watches one address on a specific RPC endpoint's subscriber. Success
   * marks it "subscribed" via the "watching" event handler above (the
   * single place that happens, so automatic resubscription after a
   * reconnect - which bypasses this method - gets the same DB update).
   */
  async watch(address, url) {
    const sub = this.subscribers.get(url);
    if (!sub) throw new Error(`No active subscriber for RPC endpoint ${url}`);
    try {
      await sub.watch(address);
    } catch (err) {
      await markSubscriptionFailed(address).catch(() => {});
      throw err;
    }
  }

  /** Stops watching one address on a specific endpoint's subscriber. No-op if that endpoint no longer exists. */
  async unwatch(address, url) {
    const sub = this.subscribers.get(url);
    if (!sub) return;
    await sub.unwatch(address);
  }

  /** All addresses currently watched, across every active endpoint. */
  watchedAddresses() {
    const all = [];
    for (const sub of this.subscribers.values()) all.push(...sub.watchedAddresses());
    return all;
  }

  /**
   * Force-reconnects one RPC endpoint's WebSocket (triggering its normal
   * auto-reconnect + resubscribe flow), or every endpoint if no url is given.
   */
  reconnect(url) {
    if (url) {
      const sub = this.subscribers.get(url);
      if (!sub) throw new Error(`No active subscriber for RPC endpoint ${url}`);
      logEvent("rpc", `Manual reconnect requested: ${url}`, { meta: { url } });
      sub.forceReconnect();
      return;
    }
    logEvent("rpc", "Manual reconnect requested (all endpoints)");
    for (const sub of this.subscribers.values()) sub.forceReconnect();
  }

  /**
   * One pass: make the RpcEndpoint pool, the address-to-endpoint assignment,
   * and the live watched set all match what's in MongoDB. Guarded against
   * overlapping runs - with enough tracked addresses, one pass (200ms
   * stagger per new watch()) can take longer than the poll interval, and a
   * second pass starting before the first finishes could queue a second
   * concurrent watch() for an address still mid-assignment, double-
   * subscribing it (every real signature notification then arrives twice,
   * multiplying parse/RPC load and burning through RPS limits for no
   * reason - this exact bug was hit and fixed once already this session).
   */
  async syncWatchedFromDb() {
    if (this._syncInProgress) return;
    this._syncInProgress = true;
    try {
      await this._doSyncWatchedFromDb();
    } finally {
      this._syncInProgress = false;
    }
  }

  async _doSyncWatchedFromDb() {
    await connectDb();

    // 1. Make the live subscriber pool match RpcEndpoint (enabled ones only get a connection).
    const endpoints = await RpcEndpoint.find({}, { url: 1, enabled: 1 }).lean();
    const activeEndpointUrls = new Set(endpoints.filter((e) => e.enabled).map((e) => e.url));
    for (const ep of endpoints) {
      if (ep.enabled && !this.subscribers.has(ep.url)) this._createSubscriber(ep.url);
    }

    // 2. Sticky rebalance: persists assignedRpcUrl for every active trader
    // against the currently-active endpoints, touching only what changed.
    await rebalanceAssignments();

    // 3. Reconcile live watch state against the (now up to date) assignment.
    const traders = await Trader.find({ status: "active" }, { address: 1, assignedRpcUrl: 1 }).lean();
    const desiredAddresses = new Set(traders.map((t) => t.address));

    // One address at a time, strictly make-before-break: the address is
    // subscribed on its new endpoint FIRST, and only once that has
    // succeeded is it unsubscribed from the old one - so it is never
    // unwatched anywhere while a trade could be landing on it. A failed
    // watch (typically an RPS rate limit) leaves it exactly where it was
    // and it is retried on the next sync pass; it's never dropped.
    let consecutiveFailures = 0;
    // Random order each pass, so a few persistently-failing addresses at
    // the front can't use up every pass's failure budget and starve the rest.
    for (let i = traders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [traders[i], traders[j]] = [traders[j], traders[i]];
    }
    for (const trader of traders) {
      const targetUrl = trader.assignedRpcUrl;
      if (!targetUrl || !this.subscribers.has(targetUrl)) continue; // unresolved - no active endpoint to place it on
      const targetSub = this.subscribers.get(targetUrl);
      if (targetSub.watchedAddresses().includes(trader.address)) continue; // already correctly placed
      // Don't queue behind a dead connection (it would block this whole
      // pass until the socket comes back) - it's retried next pass.
      if (!targetSub.ws || targetSub.ws.readyState !== WebSocket.OPEN) continue;

      try {
        await this.watch(trader.address, targetUrl);
        consecutiveFailures = 0;
      } catch (err) {
        this.emit("error", err);
        consecutiveFailures += 1;
        // Rate-limited: stop hammering the provider this pass. Everything
        // not yet placed is retried on the next sync, still on its old endpoint.
        if (consecutiveFailures >= WATCH_FAILURES_BEFORE_ABORT) break;
        await sleep(WATCH_FAILURE_BACKOFF_MS);
        continue;
      }
      await sleep(WATCH_STAGGER_MS);

      // Now safely live on the new endpoint - drop it from any other one.
      for (const [url, sub] of this.subscribers) {
        if (url === targetUrl || !sub.watchedAddresses().includes(trader.address)) continue;
        if (sub.ws && sub.ws.readyState === WebSocket.OPEN) {
          await this.unwatch(trader.address, url).catch((err) => this.emit("error", err));
        } else {
          // That endpoint is disconnected - nothing to unsubscribe
          // server-side (the old socket already died); just forget it
          // locally so it isn't resubscribed there on reconnect.
          sub.forget(trader.address);
        }
      }
    }

    // 4. Unwatch anything no longer desired (blacklisted/removed trader), wherever it currently lives.
    for (const [url, sub] of this.subscribers) {
      for (const address of sub.watchedAddresses()) {
        if (!desiredAddresses.has(address)) {
          await this.unwatch(address, url).catch((err) => this.emit("error", err));
        }
      }
    }

    // 5. Tear down subscribers for endpoints that are gone/disabled - their
    // addresses were already relocated in step 3.
    for (const url of [...this.subscribers.keys()]) {
      if (!activeEndpointUrls.has(url)) this._teardownSubscriber(url);
    }
  }

  /** Starts polling Mongo for trader/RPC-endpoint changes. */
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
   * Polls SystemCommand for a manual "reconnect" request queued from the UI
   * (the web app and this daemon are separate Node processes with no direct
   * channel, so Mongo is the handoff). Claims each due command atomically
   * (pending -> processing) before acting, same pattern as PendingExecution.
   */
  async _pollCommands() {
    const claimed = await SystemCommand.findOneAndUpdate(
      { type: "reconnect_rpc", status: "pending" },
      { $set: { status: "processing" } },
      { returnDocument: "after" }
    ).catch((err) => {
      this.emit("error", err);
      return null;
    });
    if (!claimed) return;
    try {
      this.reconnect(claimed.targetUrl || null);
      await SystemCommand.updateOne({ _id: claimed._id }, { $set: { status: "done", completedAt: new Date() } });
    } catch (err) {
      await SystemCommand.updateOne(
        { _id: claimed._id },
        { $set: { status: "failed", completedAt: new Date(), error: err.message || String(err) } }
      );
    }
  }

  startCommandPolling(intervalMs = 5000) {
    this._commandTimer = setInterval(() => {
      this._pollCommands().catch((err) => this.emit("error", err));
    }, intervalMs);
  }

  stopCommandPolling() {
    if (this._commandTimer) {
      clearInterval(this._commandTimer);
      this._commandTimer = null;
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
   * changed live from Settings (SystemSettings.riskCheckIntervalSeconds - a
   * system-wide cadence, not per-profile, since one sweep covers every open
   * position across every profile) - each cycle re-reads it before
   * scheduling the next one, so a change takes effect on the very next
   * tick, no daemon restart needed.
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
      const settings = await getSystemSettings();
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
      // NOT persisted to SystemLog: on a wallet list this size, on-chain tx
      // failures (bad slippage, front-run, etc.) happen at a volume that
      // would drown out anything actually useful in the Logs UI and blow
      // through Mongo write throughput between the TTL sweeps that are
      // supposed to bound it - this is chain noise, not a tracking/RPC
      // health signal. Still emitted for the console/PM2 log if anyone
      // wants that level of detail.
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
          if (isNew) {
            const actioned = await evaluateRealTrade(trade);
            if (actioned) await markTradeActioned(trade);
          }
        } catch (dbErr) {
          this.emit("dbError", { address, signature, error: dbErr });
          logEvent("tracker", `Failed to persist trade for ${signature}: ${dbErr.message}`, {
            level: "error",
            meta: { address, signature },
          });
        }
        this.emit("trade", trade);
      }
    } catch (error) {
      this.emit("parseError", { address, signature, error });
      logEvent("tracker", `Failed to parse ${signature}: ${error.message}`, { level: "error", meta: { address, signature } });
    }
  }

  close() {
    this.stopDbSync();
    this.stopSimulationLoops();
    this.stopCommandPolling();
    for (const sub of this.subscribers.values()) sub.close();
    this.subscribers.clear();
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

  // One-time: seed RpcEndpoint from .env if nothing's been configured via
  // the /rpc UI yet. After this, .env's SOLANA_WS_URLS is never consulted
  // again - endpoints are added/removed from the UI from here on.
  const seedWsUrls = config.wsUrls.length ? config.wsUrls : deriveWsFromHttp(config.rpcUrls);
  await ensureRpcEndpointsSeeded(seedWsUrls);

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
    "[tracker] watch list is driven by MongoDB (Trader + RpcEndpoint collections), polled every 15s.",
  );
  tracker.startDbSync(15000);
  tracker.startSimulationLoops();
  tracker.startCommandPolling();
}

// PM2 launches scripts through its own container wrapper, so process.argv[1]
// is not this file's path there - also honour PM2's pm_exec_path.
const isMain = [process.argv[1], process.env.pm_exec_path].some(
  (p) => p && path.resolve(p) === fileURLToPath(import.meta.url),
);
if (isMain) {
  runCli().catch((err) => {
    console.error("[tracker] fatal:", err.message || err);
    process.exit(1);
  });
}
