import { computeTradeFees } from "../fees.js";

/**
 * Replays ONE copy-trade over a token's real pool history. Pure with respect
 * to I/O: all network access goes through `api.fetchRange(mint, fromSec,
 * toSec)` (see PumpTradesClient), so this is testable with a fake.
 *
 * Timeline, mirroring the live engine:
 *   trader buys at Tb  -> our buy fills at Te = Tb + delay, at the pool price at Te
 *   every pool price change after that is checked against the strategy:
 *     stop-loss, take-profit, trailing stops   (decided at that trade's time)
 *   or the trader's own sell at Ts, or max hold time (Te + maxTradeTimeSeconds)
 *   the exit fills `delay` seconds after it was decided, at the pool price then.
 *
 * "Pool price at time T" = the pre-trade price (`priceUsd`) of the first trade
 * at or after T - the pool state right after whatever traded before T. That
 * stays exact even when nothing trades for a while.
 */

export class UnresolvedError extends Error {}

const MAX_WINDOW_SECONDS = 3 * 24 * 3600; // a quiet token's whole history fits in one page, so long windows are cheap
const TARGET_TRADES_PER_WINDOW = 70; // a window should hold about one page (100) of trades
const JUMP_SECONDS = 600; // a price needed this far beyond what was scanned is fetched directly instead of scanning the gap

/**
 * A growing, gap-free read of a token's trades from `fromSec` onward. Each
 * `extend()` reads the next time window completely (so nothing inside it can
 * be missed), then resizes the following window to the observed trade density:
 * starts at `initialWindow` seconds, shrinks when the token is busy, grows when quiet.
 */
class TradeStream {
  constructor({ mint, fromSec, limitSec, api, initialWindow }) {
    this.mint = mint;
    this.limitSec = limitSec;
    this.api = api;
    this.window = initialWindow;
    this.coveredUntil = fromSec - 1;
    this.trades = [];
    this.prior = null;
    this.firstFetch = true;
  }

  get exhausted() {
    return this.coveredUntil >= this.limitSec;
  }

  async extend() {
    const from = this.coveredUntil + 1;
    const to = Math.min(from + this.window - 1, this.limitSec);
    const res = await this.api.fetchRange(this.mint, from, to);
    if (this.firstFetch) {
      this.prior = res.prior;
      this.firstFetch = false;
    }
    this.trades.push(...res.trades);
    this.coveredUntil = to;
    const n = res.trades.length;
    // Aim the next window at ~TARGET trades, but never grow more than 8x in one step (overshooting a suddenly-busy token costs extra pages).
    const factor = n === 0 ? 4 : Math.min(8, TARGET_TRADES_PER_WINDOW / n);
    this.window = Math.max(5, Math.min(MAX_WINDOW_SECONDS, Math.round(this.window * factor)));
    return res.trades;
  }

  async coverTo(sec) {
    while (this.coveredUntil < Math.min(sec, this.limitSec)) await this.extend();
  }

  /** First trade with ts >= sec among what has been read so far. */
  firstAtOrAfter(sec) {
    for (const t of this.trades) if (t.ts >= sec) return t;
    return null;
  }
}

const r = (n) => (Number.isFinite(n) ? n : null);

/**
 * @param {object} p
 * @param {string} p.mint
 * @param {{signature:string, blockTime:number, solAmount:number|null}} p.buy       the trader's first valid buy
 * @param {{signature:string, blockTime:number}|null} p.traderSell                   the sell we copy, if any
 * @param {object} p.settings        frozen profile settings (see service.js snapshotProfileSettings)
 * @param {number} p.windowEndSec    nothing after this instant exists for the backtest
 * @param {object} p.api             { fetchRange }
 * @param {number} p.initialWindow   seconds
 * @param {(usdPerSol:number, atSec:number)=>void} [p.onUsdPerSol]
 * @param {(openAtSec:number, outlayUsd:number)=>boolean} [p.canOpen]  balance gate, called once the buy is known to be non-dust
 * @returns {Promise<object>} { outcome: "dust"|"skipped"|"closed"|"open", ...fields }
 */
export async function simulatePosition({ mint, buy, traderSell, settings, windowEndSec, api, initialWindow, onUsdPerSol, canOpen }) {
  const delay = Math.max(0, settings.executionDelaySeconds ?? 2);
  const te = buy.blockTime + delay;
  if (te > windowEndSec) return { outcome: "skipped", reason: "no_data" }; // the fill would land after the backtest window

  const stream = new TradeStream({ mint, fromSec: te, limitSec: windowEndSec, api, initialWindow });

  // ---- entry price: pool price at Te (pre-trade price of the first trade at/after it)
  while (stream.trades.length === 0 && !stream.exhausted) await stream.extend();
  let entryTrade = stream.trades[0] ?? null;
  const reference = entryTrade ?? stream.prior; // anything with a price/SOL pair, for the SOL/USD rate
  if (!reference) return { outcome: "skipped", reason: "no_data" };

  const usdPerSol = reference.priceSol > 0 ? reference.priceUsd / reference.priceSol : null;
  if (!usdPerSol) return { outcome: "skipped", reason: "no_data" };
  onUsdPerSol?.(usdPerSol, buy.blockTime);

  // ---- dust check on the trader's buy (same rule as live: USD value below dustBuyUsd)
  const traderBuyUsd = buy.solAmount != null ? buy.solAmount * usdPerSol : null;
  if (traderBuyUsd == null) return { outcome: "skipped", reason: "no_data" };
  if (traderBuyUsd < settings.dustBuyUsd) return { outcome: "dust", traderBuyUsd };

  const buyPriceUsd = entryTrade ? entryTrade.priceUsd : stream.prior.fillPriceUsd;
  const buyPriceSource = entryTrade ? "trade" : "prior_trade";
  if (!(buyPriceUsd > 0)) return { outcome: "skipped", reason: "no_data" };

  const spendUsd = settings.tradeSizeUsd;
  const buyFees = computeTradeFees(spendUsd, settings);
  if (canOpen && !canOpen(te, spendUsd + buyFees.totalFeeUsd)) return { outcome: "skipped", reason: "insufficient_balance", traderBuyUsd };

  const tokenAmount = spendUsd / buyPriceUsd;
  const totalCost = spendUsd + buyFees.totalFeeUsd;
  const unrealizedPct = (value) => ((value - totalCost) / totalCost) * 100;

  const position = {
    traderBuyUsd,
    openedAtSec: te,
    buyPriceUsd,
    buyPriceSource,
    tokenAmount,
    costBasisUsd: spendUsd,
    buyFeeUsd: buyFees.totalFeeUsd,
  };

  // ---- exit rules
  const stopLoss = settings.stopLossPercent;
  const takeProfit = settings.takeProfitPercent;
  const maxHold = settings.maxTradeTimeSeconds > 0 ? settings.maxTradeTimeSeconds : 0;
  const trailingStops = settings.trailingStops || [];
  const hasRisk = (stopLoss != null) || (takeProfit != null) || maxHold > 0 || trailingStops.length > 0;

  const traderSellTime = traderSell ? traderSell.blockTime : null;
  // Scanning needs to go no further than the earliest time-based exit.
  let scanLimit = windowEndSec;
  if (traderSellTime != null) scanLimit = Math.min(scanLimit, traderSellTime);
  if (maxHold > 0) scanLimit = Math.min(scanLimit, te + maxHold);

  let maxU = unrealizedPct(spendUsd);
  let minU = maxU;
  let scanned = 0;
  const armed = new Set();
  let risk = null; // { at, reason }

  const evaluate = (ts, price) => {
    const value = tokenAmount * price;
    const u = unrealizedPct(value);
    if (u > maxU) maxU = u;
    if (u < minU) minU = u;
    if (stopLoss != null && u <= -Math.abs(stopLoss)) return "stop_loss";
    if (takeProfit != null && u >= Math.abs(takeProfit)) return "take_profit";
    for (const rule of trailingStops) {
      const id = String(rule._id);
      if (!armed.has(id)) {
        if (u >= rule.armPercent) armed.add(id);
      } else if (u <= rule.exitPercent) {
        return "trailing_stop";
      }
    }
    return null;
  };

  if (hasRisk) {
    // Walk every pool price from the entry trade onward, in order, extending the read as needed.
    let idx = entryTrade ? 0 : stream.trades.length;
    scan: for (;;) {
      while (idx < stream.trades.length) {
        const t = stream.trades[idx++];
        if (t.ts > scanLimit) break scan;
        scanned += 1;
        const reason = evaluate(t.ts, t.priceUsd);
        if (reason) {
          risk = { at: t.ts, reason };
          break scan;
        }
      }
      if (stream.coveredUntil >= scanLimit) break;
      await stream.extend();
    }
  }

  // ---- decide how it ends: earliest of risk trigger / trader sell / max hold (ties: risk, trader, hold)
  const candidates = [];
  if (risk) candidates.push({ at: risk.at, prio: 0, reason: risk.reason });
  if (traderSellTime != null) candidates.push({ at: traderSellTime, prio: 1, reason: "trader_sell" });
  if (maxHold > 0) candidates.push({ at: te + maxHold, prio: 2, reason: "max_hold_time" });
  candidates.sort((a, b) => a.at - b.at || a.prio - b.prio);
  const exit = candidates[0] ?? null;

  // Without any exit rule nothing is scanned, so there is no peak/trough to report.
  const excursion = () => (hasRisk ? { maxUnrealizedPnlPercent: r(maxU), minUnrealizedPnlPercent: r(minU) } : { maxUnrealizedPnlPercent: null, minUnrealizedPnlPercent: null });
  const base = { ...position, tradesScanned: scanned, ...excursion() };
  const traderSellFields = traderSell ? { traderSellSignature: traderSell.signature, traderSellTime: traderSell.blockTime } : {};

  const tf = exit ? exit.at + delay : null;
  if (!exit || tf > windowEndSec) {
    // Never exited inside the window: mark at the last pool price.
    const last = await api.fetchRange(mint, windowEndSec, windowEndSec);
    const markPrice = last.trades.at(-1)?.fillPriceUsd ?? last.prior?.fillPriceUsd ?? stream.trades.at(-1)?.fillPriceUsd ?? buyPriceUsd;
    const value = tokenAmount * markPrice;
    return {
      outcome: "open",
      ...base,
      ...traderSellFields,
      markPriceUsd: markPrice,
      unrealizedPnlUsd: value - totalCost,
      unrealizedPnlPercent: unrealizedPct(value),
    };
  }

  // ---- exit price: pool price at the fill time
  let exitStream = stream;
  if (tf - stream.coveredUntil > JUMP_SECONDS) {
    exitStream = new TradeStream({ mint, fromSec: tf, limitSec: windowEndSec, api, initialWindow });
  }
  let exitTrade = exitStream.firstAtOrAfter(tf);
  while (!exitTrade && !exitStream.exhausted) {
    await exitStream.extend();
    exitTrade = exitStream.firstAtOrAfter(tf);
  }
  const sellPriceUsd = exitTrade
    ? exitTrade.priceUsd
    : exitStream.trades.at(-1)?.fillPriceUsd ?? exitStream.prior?.fillPriceUsd ?? stream.trades.at(-1)?.fillPriceUsd ?? buyPriceUsd;

  const proceedsUsd = tokenAmount * sellPriceUsd;
  const sellFees = computeTradeFees(proceedsUsd, settings);
  const realizedPnlUsd = proceedsUsd - sellFees.totalFeeUsd - totalCost;
  // The exit fill is one more price sample for the peak/trough tracker.
  const exitU = unrealizedPct(proceedsUsd);
  if (exitU > maxU) maxU = exitU;
  if (exitU < minU) minU = exitU;

  return {
    outcome: "closed",
    ...base,
    ...excursion(),
    ...traderSellFields,
    closeSignalSec: exit.at,
    closedAtSec: tf,
    closeReason: exit.reason,
    sellPriceUsd,
    proceedsUsd,
    sellFeeUsd: sellFees.totalFeeUsd,
    realizedPnlUsd,
    realizedPnlPercent: (realizedPnlUsd / totalCost) * 100,
  };
}
