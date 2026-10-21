import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { BacktestAddress } from "../models/BacktestAddress.js";
import { computeStreaks } from "../pnl.js";
import { traderProgressPercent } from "./progress.js";
import { lossDepthView } from "./dayStats.js";

/**
 * The per-address detail behind the backtest address page: a simulated wallet
 * (what the same address would look like as a live trader) and its P&L over
 * the backtest window.
 *
 * The wallet starts at the profile's allocation. A trade held at the end of a
 * moment is valued at what it cost (fees included) until it closes, so the
 * wallet value moves only when trades close - then at the very end of the
 * window the still-open trades are marked at their last price. That makes the
 * hourly and daily value exact, with no snapshots to estimate from.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (key) => Date.parse(`${key}T00:00:00Z`);
const PERIOD_DAYS = { day: 1, week: 7, month: 30 };

const POSITION_FIELDS = {
  status: 1,
  openedAt: 1,
  closedAt: 1,
  costBasisUsd: 1,
  buyFeeUsd: 1,
  proceedsUsd: 1,
  sellFeeUsd: 1,
  realizedPnlUsd: 1,
  realizedPnlPercent: 1,
  unrealizedPnlUsd: 1,
};

/** The cash/value timeline of one address's trades: sorted events plus the end-of-window figures. */
async function loadLedger(run, address) {
  const positions = await BacktestPosition.find({ runId: run._id, address, status: { $in: ["closed", "open"] } }, POSITION_FIELDS).lean();
  const starting = run.settings?.allocationUsd ?? 0;

  const closes = []; // { t, pnl, pct }
  const cashEvents = []; // { t, delta, order } - closes (order 0) settle before buys (order 1) at the same instant
  let unrealizedOpen = 0;
  let openCostBasis = 0;
  let openCount = 0;
  for (const p of positions) {
    const cost = (p.costBasisUsd || 0) + (p.buyFeeUsd || 0);
    if (p.openedAt) cashEvents.push({ t: new Date(p.openedAt).getTime(), delta: -cost, order: 1 });
    if (p.status === "closed" && p.closedAt) {
      const t = new Date(p.closedAt).getTime();
      closes.push({ t, pnl: p.realizedPnlUsd || 0, pct: p.realizedPnlPercent || 0 });
      cashEvents.push({ t, delta: (p.proceedsUsd || 0) - (p.sellFeeUsd || 0), order: 0 });
    } else if (p.status === "open") {
      unrealizedOpen += p.unrealizedPnlUsd || 0;
      openCostBasis += cost;
      openCount += 1;
    }
  }
  closes.sort((a, b) => a.t - b.t);
  cashEvents.sort((a, b) => a.t - b.t || a.order - b.order);

  const cumulative = []; // running realized P&L after each close
  let sum = 0;
  for (const c of closes) cumulative.push((sum += c.pnl));
  const realizedTotal = sum;

  // Cash can dip below zero when the profile allows a negative balance - count each buy that leaves it there.
  const negativeByDay = new Map();
  let cash = starting;
  let negativeCount = 0;
  let maxNegativeDepth = 0;
  for (const e of cashEvents) {
    cash += e.delta;
    if (e.order === 1 && cash < 0) {
      negativeCount += 1;
      maxNegativeDepth = Math.max(maxNegativeDepth, -cash);
      const k = dayKey(e.t);
      const d = negativeByDay.get(k) ?? { date: k, count: 0, maxDepthUsd: 0 };
      d.count += 1;
      d.maxDepthUsd = Math.max(d.maxDepthUsd, -cash);
      negativeByDay.set(k, d);
    }
  }

  const windowEnd = run.windowEnd.getTime();
  /** Realized P&L of everything that closed at or before t. */
  const realizedAt = (t) => {
    let lo = 0;
    let hi = closes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (closes[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? 0 : cumulative[lo - 1];
  };
  /** Wallet value at t; the open trades are only marked once the window has ended. */
  const valueAt = (t) => starting + realizedAt(t) + (t >= windowEnd ? unrealizedOpen : 0);

  return {
    starting,
    closes,
    // The deepest the realised P&L got (see lossDepthView): one wallet through the whole window, so no daily reset.
    lossDepth: lossDepthView(closes.map((c) => ({ t: c.t, day: dayKey(c.t), pnlUsd: c.pnl })), { startingUsd: starting }),
    negativeByDay,
    negativeCount,
    maxNegativeDepth,
    realizedTotal,
    unrealizedOpen,
    openCount,
    closedCount: closes.length,
    cashNow: cash,
    openCostBasis,
    valueAt,
  };
}

/** The address's row in the run, in the same shape the run page's address list uses. */
export function toTraderView(rt, label, stats) {
  return {
    address: rt.address,
    label: label || "",
    stage: rt.stage,
    error: rt.error,
    progressPercent: traderProgressPercent(rt),
    collect: rt.collect,
    sim: rt.sim,
    stats,
  };
}

/**
 * Header data for the address page: the run's definition, this address's
 * progress and stats, and its simulated wallet.
 * @param {string} runId @param {string} address
 */
export async function getRunAddress(runId, address, { statsFor }) {
  const run = await BacktestRun.findById(runId).lean();
  if (!run) return null;
  const [rt, addressDoc] = await Promise.all([BacktestRunTrader.findOne({ runId, address }).lean(), BacktestAddress.findOne({ address }, { label: 1, notes: 1 }).lean()]);
  if (!rt) return null;
  const [ledger, stats] = await Promise.all([loadLedger(run, address), statsFor(run._id, address)]);

  const s = run.settings || {};
  return {
    run: {
      _id: run._id,
      name: run.name,
      days: run.days,
      windowStart: run.windowStart,
      windowEnd: run.windowEnd,
      profileName: run.profileName,
      settings: s,
      status: run.status,
      control: run.control,
    },
    trader: toTraderView(rt, addressDoc?.label, stats),
    notes: addressDoc?.notes || "",
    wallet: {
      startingUsd: ledger.starting,
      balanceUsd: ledger.cashNow, // uncommitted cash, as on a live trader
      walletValueUsd: ledger.starting + ledger.realizedTotal + ledger.unrealizedOpen,
      realizedPnlUsd: ledger.realizedTotal,
      unrealizedPnlUsd: ledger.unrealizedOpen,
      openPositionCount: ledger.openCount,
      closedPositionCount: ledger.closedCount,
      negativeBalanceEventCount: ledger.negativeCount,
      maxNegativeBalanceUsd: ledger.maxNegativeDepth,
    },
    lossDepth: ledger.lossDepth,
  };
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Day / week / month (or the whole window) P&L for one address - the same
 * shape as a live wallet's /pnl response, so the same chart renders it.
 * Defaults to the periods ending on the last day of the backtest window.
 * @param {string} runId @param {string} address
 * @param {{period?: "day"|"week"|"month"|"all", date?: string}} [opts]
 */
export async function getRunAddressPnl(runId, address, { period = "week", date } = {}) {
  const run = await BacktestRun.findById(runId).lean();
  if (!run) return null;
  const rt = await BacktestRunTrader.findOne({ runId, address }, { stage: 1, "sim.simulatedThrough": 1 }).lean();
  if (!rt) return null;

  const ledger = await loadLedger(run, address);
  const windowStartKey = dayKey(run.windowStart);
  const windowEndKey = dayKey(run.windowEnd);
  const windowDays = Math.round((dayStart(windowEndKey) - dayStart(windowStartKey)) / DAY_MS) + 1;

  const anchor = date && date >= windowStartKey && date <= windowEndKey ? date : windowEndKey;
  const length = period === "all" ? windowDays : PERIOD_DAYS[period] ?? 7;
  const firstKey = dayKey(Math.max(dayStart(windowStartKey), dayStart(anchor) - (length - 1) * DAY_MS));
  const lastKey = anchor;

  // Closed trades bucketed by UTC day (and hour for the day view).
  const byDay = new Map();
  const byHour = new Map();
  for (const c of ledger.closes) {
    const k = dayKey(c.t);
    const d = byDay.get(k) ?? { pnl: 0, pct: 0, trades: 0, wins: 0, losses: 0 };
    d.pnl += c.pnl;
    d.pct += c.pct;
    d.trades += 1;
    if (c.pnl > 0) d.wins += 1;
    else if (c.pnl < 0) d.losses += 1;
    byDay.set(k, d);
    if (period === "day" && k === anchor) {
      const h = new Date(c.t).getUTCHours();
      const hb = byHour.get(h) ?? { pnl: 0, trades: 0, wins: 0, losses: 0 };
      hb.pnl += c.pnl;
      hb.trades += 1;
      if (c.pnl > 0) hb.wins += 1;
      else if (c.pnl < 0) hb.losses += 1;
      byHour.set(h, hb);
    }
  }

  const windowStartMs = run.windowStart.getTime();
  const windowEndMs = run.windowEnd.getTime();
  // Value at the very start of the first day: the allocation if that is also the window's first day, else the previous day's close.
  const valueBefore = (key) => (key <= windowStartKey ? ledger.starting : ledger.valueAt(dayStart(key) - 1));

  const dailyBreakdown = [];
  for (let t = dayStart(firstKey); t <= dayStart(lastKey); t += DAY_MS) {
    const k = dayKey(t);
    const d = byDay.get(k);
    const endMs = Math.min(t + DAY_MS - 1, windowEndMs);
    const start = valueBefore(k);
    const end = ledger.valueAt(endMs);
    dailyBreakdown.push({
      date: k,
      valueUsd: round(end),
      actualizedUsd: round(end - start),
      actualizedPercent: start !== 0 ? round(((end - start) / start) * 100) : null,
      combinedUsd: round(d?.pnl ?? 0),
      combinedPercent: round(d?.pct ?? 0),
      closedTradeCount: d?.trades ?? 0,
      wins: d?.wins ?? 0,
      losses: d?.losses ?? 0,
    });
  }

  let hourlyBreakdown;
  if (period === "day") {
    hourlyBreakdown = [];
    let cum = 0;
    for (let h = 0; h < 24; h++) {
      const slotStart = dayStart(anchor) + h * HOUR_MS;
      const slotEnd = slotStart + HOUR_MS - 1;
      const hb = byHour.get(h);
      cum += hb?.pnl ?? 0;
      const inWindow = slotEnd >= windowStartMs && slotStart <= windowEndMs;
      hourlyBreakdown.push({
        hour: h,
        label: `${String(h).padStart(2, "0")}:00`,
        pnlUsd: round(hb?.pnl ?? 0),
        cumulativePnlUsd: inWindow ? round(cum) : null,
        tradeCount: hb?.trades ?? 0,
        wins: hb?.wins ?? 0,
        losses: hb?.losses ?? 0,
        valueUsd: inWindow ? round(ledger.valueAt(Math.min(slotEnd, windowEndMs))) : null,
        valueEstimated: false,
      });
    }
  }

  const closedTradeCount = dailyBreakdown.reduce((n, d) => n + d.closedTradeCount, 0);
  const wins = dailyBreakdown.reduce((n, d) => n + d.wins, 0);
  const losses = dailyBreakdown.reduce((n, d) => n + d.losses, 0);
  const periodStart = valueBefore(firstKey);
  const periodEnd = dailyBreakdown.at(-1)?.valueUsd ?? periodStart;
  const through = rt.stage === "done" || rt.stage === "failed" || rt.stage === "skipped" ? null : rt.sim?.simulatedThrough ? dayKey(rt.sim.simulatedThrough) : "";

  return {
    period,
    date: anchor,
    days: dailyBreakdown.length,
    actualizedUsd: round(periodEnd - periodStart),
    combinedUsd: round(dailyBreakdown.reduce((n, d) => n + d.combinedUsd, 0)),
    combinedPercent: round(dailyBreakdown.reduce((n, d) => n + d.combinedPercent, 0)),
    closedTradeCount,
    wins,
    losses,
    winRatePercent: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
    averageTradesPerDay: dailyBreakdown.length > 0 ? closedTradeCount / dailyBreakdown.length : 0,
    dailyBreakdown,
    hourlyBreakdown,
    streaks: computeStreaks(dailyBreakdown),
    negativeBalanceBreakdown: dailyBreakdown.map((d) => ({ date: d.date, count: ledger.negativeByDay.get(d.date)?.count ?? 0, maxDepthUsd: ledger.negativeByDay.get(d.date)?.maxDepthUsd ?? 0 })),
    // Where the window starts/ends, so the page can limit day navigation; `through` says how far a still-running address has been simulated.
    range: { from: windowStartKey, to: windowEndKey },
    through,
  };
}
