import { Wallet } from "../models/Wallet.js";
import { WalletTrader } from "../models/WalletTrader.js";
import { Trader } from "../models/Trader.js";
import { getSystemSettings } from "../models/SystemSettings.js";
import { logEvent } from "../systemLog.js";
import { userTradesClient } from "./apiClients.js";
import { recordApiTrade, markApiTradeActioned } from "./apiLedger.js";
import { evaluateWalletTrade } from "./walletEngine.js";

/**
 * The "api" tracking method (Wallet.settings.trackingMethod): instead of waiting for a trader's transaction to arrive through the RPC
 * log subscription, this asks pump.fun's user-trades API for the trader's newest trades several times a second and feeds each new one
 * into the same wallet simulation (evaluateWalletTrade, restricted to the wallets that track by API).
 *
 * Which traders are polled: every trader of every wallet set to "api" (a trader is polled once however many API wallets hold them,
 * and not at all if only log wallets do). A trader in both kinds of wallet is still followed by the logs for the log wallets - the two
 * methods never share a trade, see db/models/ApiTrade.js.
 *
 * One polling loop per trader, fully independent of the others (never a Promise.all over the traders - a slow answer for one trader
 * must not hold up the rest), one request in flight at a time: the next request goes out about `1000 / pollsPerSecond` ms after the
 * last one STARTED (randomised ±30%), or as soon as the last one finished if it took longer. The proxy pool's own pacing is the real ceiling - with fewer
 * proxies than the rate asks for, traders are simply polled less often, and the periodic log line says by how much.
 */

const SYNC_INTERVAL_MS = 10_000;
const STATS_INTERVAL_MS = 60_000;
const POLL_LIMIT = 20; // newest trades per request; a trader doesn't make 20 trades between two polls
const SEEN_PER_TRADER = 500; // remembered trade ids per trader, for telling new trades from ones already seen
// A trade first seen older than this is history, not a signal: a buy is skipped (copying it now wouldn't be a faithful copy), and
// when a loop starts everything older is ignored outright. A SELL seen late is still acted on - missing it would leave a position open.
const FRESH_BUY_SECONDS = 30;
const MAX_BACKOFF_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiTradePoller {
  /** @param {{ onError?: (err: Error) => void }} [options] */
  constructor({ onError = () => {} } = {}) {
    this.onError = onError;
    this.loops = new Map(); // trader address -> { stopped, seen: Set, started: boolean }
    this.intervalMs = 1000 / 3;
    this.syncTimer = null;
    this.statsTimer = null;
    this.syncing = false;
    this.stats = this.#freshStats();
    this.lastErrorLogAt = 0;
  }

  #freshStats() {
    return { startedAt: Date.now(), polls: 0, errors: 0, newTrades: 0, staleBuys: 0 };
  }

  start() {
    this.sync().catch(this.onError);
    this.syncTimer = setInterval(() => this.sync().catch(this.onError), SYNC_INTERVAL_MS);
    this.statsTimer = setInterval(() => this.#logStats(), STATS_INTERVAL_MS);
  }

  stop() {
    clearInterval(this.syncTimer);
    clearInterval(this.statsTimer);
    this.syncTimer = this.statsTimer = null;
    for (const loop of this.loops.values()) loop.stopped = true;
    this.loops.clear();
  }

  /** Makes the running loops match the database: one per trader of an API wallet, at the configured rate. */
  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const settings = await getSystemSettings();
      const perSecond = Number(settings.apiPollsPerSecond) || 3;
      this.intervalMs = 1000 / Math.max(0.2, perSecond);
      this.targetPerSecond = perSecond;

      const wallets = await Wallet.find({ "settings.trackingMethod": "api" }, { _id: 1 }).lean();
      const addresses = wallets.length
        ? await WalletTrader.distinct("traderAddress", { walletId: { $in: wallets.map((w) => w._id) } })
        : [];
      const active = addresses.length ? await Trader.find({ address: { $in: addresses }, status: "active" }, { address: 1 }).lean() : [];
      const desired = new Set(active.map((t) => t.address));

      for (const [address, loop] of this.loops) {
        if (!desired.has(address)) {
          loop.stopped = true;
          this.loops.delete(address);
        }
      }
      let index = 0;
      const fresh = [...desired].filter((address) => !this.loops.has(address));
      for (const address of fresh) {
        const loop = { stopped: false, seen: new Set(), started: false };
        this.loops.set(address, loop);
        // Spread the first requests over one interval so the traders aren't all polled in the same instant.
        const offset = (index++ / fresh.length) * this.intervalMs;
        this.#run(address, loop, offset).catch(this.onError);
      }
    } finally {
      this.syncing = false;
    }
  }

  async #run(address, loop, firstDelayMs) {
    await sleep(firstDelayMs);
    let failures = 0;
    while (!loop.stopped) {
      const startedAt = Date.now();
      try {
        await this.#poll(address, loop);
        failures = 0;
      } catch (err) {
        failures += 1;
        this.stats.errors += 1;
        this.#logError(address, err);
        await sleep(Math.min(MAX_BACKOFF_MS, 250 * 2 ** Math.min(failures, 5)));
      }
      // Randomised gap (±30% around the configured rate, so the average rate is unchanged): requests that arrive at an exact
      // metronome beat, from every trader at once, are the easiest pattern for pump.fun to rate-limit or block.
      const gap = this.intervalMs * (0.7 + Math.random() * 0.6);
      await sleep(Math.max(0, gap - (Date.now() - startedAt)));
    }
  }

  async #poll(address, loop) {
    const { trades } = await userTradesClient.fetchUserTrades(address, undefined, { limit: POLL_LIMIT });
    this.stats.polls += 1;

    // Oldest first, so a buy and the sell that follows it are handled in the order they happened.
    const ordered = trades
      .filter((t) => t.kind === "trade" && t.tx && t.mint && Number.isFinite(t.ts))
      .sort((a, b) => a.ts - b.ts || String(a.slotIndexId).localeCompare(String(b.slotIndexId)));

    const firstPoll = !loop.started;
    loop.started = true;
    const nowSec = Date.now() / 1000;

    for (const t of ordered) {
      const key = t.slotIndexId || `${t.tx}:${t.mint}:${t.isBuy}`;
      if (loop.seen.has(key)) continue;
      loop.seen.add(key);
      if (loop.seen.size > SEEN_PER_TRADER) loop.seen.delete(loop.seen.values().next().value);

      const ageSec = nowSec - t.ts;
      if (firstPoll && ageSec > FRESH_BUY_SECONDS) continue; // the trader's history, not news
      if (t.isBuy && ageSec > FRESH_BUY_SECONDS) {
        this.stats.staleBuys += 1;
        continue;
      }
      this.stats.newTrades += 1;
      await this.#handle(address, t);
    }
  }

  async #handle(address, t) {
    const trade = {
      signature: t.tx,
      slot: null,
      blockTime: t.ts,
      type: t.isBuy ? "buy" : "sell",
      program: null,
      mint: t.mint,
      wallet: address,
      tokenAmount: t.tokenAmount,
      solAmount: t.amountSol,
      amountUsd: t.amountUsd,
      solAmountSource: "api",
      isNativeSolQuote: true,
      quoteMint: null,
      source: "api",
      detectedAt: Date.now(),
    };
    try {
      await recordApiTrade(trade);
      // A trade already recorded (a restart re-reads the last seconds) is evaluated again on purpose: the queue's own idempotency
      // keys make that harmless, and it is what recovers a trade the previous run saw but died before acting on.
      if (await evaluateWalletTrade(trade, { trackingMethod: "api" })) await markApiTradeActioned(trade);
    } catch (err) {
      this.onError(err);
      logEvent("tracker", `Failed to evaluate API trade ${trade.signature} for ${address}: ${err.message}`, { level: "error", meta: { address, signature: trade.signature } });
    }
  }

  /** One error line a minute at most - an outage would otherwise write one per failed request. */
  #logError(address, err) {
    if (Date.now() - this.lastErrorLogAt < 60_000) return;
    this.lastErrorLogAt = Date.now();
    logEvent("tracker", `API polling error for ${address}: ${err.message}`, { level: "warn", meta: { address } });
  }

  #logStats() {
    const traders = this.loops.size;
    if (traders === 0) return;
    const seconds = (Date.now() - this.stats.startedAt) / 1000;
    const achieved = this.stats.polls / seconds / traders; // polls per second per trader
    const target = this.targetPerSecond || 3;
    const slow = achieved < target * 0.6;
    logEvent(
      "tracker",
      `API tracking: ${traders} trader(s), ${achieved.toFixed(2)} polls/s each (target ${target}), ${this.stats.newTrades} new trade(s), ${this.stats.staleBuys} stale buy(s) skipped, ${this.stats.errors} error(s)` +
        (slow ? " - below target: add proxies or lower the rate in Settings" : ""),
      { level: slow || this.stats.errors > this.stats.polls * 0.1 ? "warn" : "info", meta: { traders, achieved, target, ...this.stats } }
    );
    this.stats = this.#freshStats();
  }
}
