import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";

/**
 * Combined backtest: every address of the run trades as ONE wallet. They share a starting balance and every trade has the same
 * size; each address's trades are still simulated on their own (a trade's result does not depend on the balance), so the shared
 * wallet is worked out afterwards from all the positions together, in the order things happened:
 *
 *   - a buy takes its cost + fee out of the balance at the moment our order fills (`openedAt`)
 *   - a sell puts proceeds - fee back at the moment the exit fills (`closedAt`)
 *   - at the same instant, sells settle before buys (same rule as the per-address wallet)
 *   - a buy that leaves the balance below zero is one negative-balance event (the same count the address page shows). With
 *     `allowNegativeBalance: false` such a buy is not taken at all - and neither is its sell.
 *
 * Reset daily: every UTC day starts again from the starting balance, as if each day were a fresh run, to see whether the group
 * can hold its balance day after day. A trade belongs to the day it was ENTERED, together with the sell that closes it, even when
 * that sell fills after midnight; nothing carries over from one day to the next. Without it the balance runs on through the whole
 * window, and a day's result is grouped by when its trades closed (like the daily breakdown of a single address).
 *
 * Because it is computed from the positions that exist, the figures are complete only once every address is simulated.
 */

const DAY_MS = 86_400_000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (key) => Date.parse(`${key}T00:00:00Z`);
const MAX_CURVE_POINTS = 600;

const POSITION_FIELDS = {
  status: 1,
  openedAt: 1,
  closedAt: 1,
  costBasisUsd: 1,
  buyFeeUsd: 1,
  proceedsUsd: 1,
  sellFeeUsd: 1,
  realizedPnlUsd: 1,
  unrealizedPnlUsd: 1,
};

/** Walks one wallet's buys and sells in order. Returns what happened; `onStep(event, cash)` sees the balance after every event. */
function walk(events, { startingUsd, allowNegativeBalance }, onStep) {
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const refused = new Set(); // positions whose buy was not affordable (only when a negative balance is not allowed)
  let cash = startingUsd;
  let lowest = startingUsd;
  let negativeCount = 0;
  let maxNegativeDepth = 0;
  for (const e of events) {
    let flag = {};
    if (e.order === 0) {
      if (refused.has(e.p)) continue; // the buy never happened, so there is nothing to sell
      cash += e.delta;
    } else if (!allowNegativeBalance && cash < -e.delta) {
      refused.add(e.p);
      flag = { refused: true };
    } else {
      cash += e.delta;
      if (cash < 0) {
        negativeCount += 1;
        maxNegativeDepth = Math.max(maxNegativeDepth, -cash);
        flag = { negative: true };
      }
    }
    if (cash < lowest) lowest = cash;
    onStep?.(e, cash, flag);
  }
  return { cash, lowest, negativeCount, maxNegativeDepth, refused };
}

const toEvents = (positions) => {
  const events = [];
  for (const p of positions) {
    const openedMs = new Date(p.openedAt).getTime();
    events.push({ t: openedMs, order: 1, delta: -((p.costBasisUsd || 0) + (p.buyFeeUsd || 0)), p });
    if (p.status === "closed" && p.closedAt) events.push({ t: new Date(p.closedAt).getTime(), order: 0, delta: (p.proceedsUsd || 0) - (p.sellFeeUsd || 0), p });
  }
  return events;
};

const emptyDay = (date, startBalanceUsd) => ({
  date,
  startBalanceUsd,
  endBalanceUsd: startBalanceUsd,
  lowestBalanceUsd: startBalanceUsd,
  pnlUsd: 0,
  trades: 0,
  wins: 0,
  losses: 0,
  negativeEvents: 0,
  maxNegativeDepthUsd: 0,
  notTaken: 0,
});

/** Keeps the shape of a long curve (and always its lowest point) while cutting it to a drawable size. */
function downsample(points) {
  if (points.length <= MAX_CURVE_POINTS) return points;
  let low = 0;
  points.forEach((p, i) => {
    if (p.balanceUsd < points[low].balanceUsd) low = i;
  });
  const step = points.length / MAX_CURVE_POINTS;
  const out = [];
  for (let i = 0; i < MAX_CURVE_POINTS; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[low], points.at(-1));
  return [...new Set(out)].sort((a, b) => a.t - b.t);
}

/**
 * @param {Array<{status: string, openedAt: Date|string, closedAt?: Date|string|null, costBasisUsd?: number, buyFeeUsd?: number, proceedsUsd?: number, sellFeeUsd?: number, realizedPnlUsd?: number, unrealizedPnlUsd?: number}>} positions closed and open ones only
 * @param {{startingUsd: number, resetDaily?: boolean, allowNegativeBalance?: boolean, windowStart: Date, windowEnd: Date}} opts
 */
export function buildCombinedLedger(positions, { startingUsd, resetDaily = false, allowNegativeBalance = true, windowStart, windowEnd }) {
  const cfg = { startingUsd, allowNegativeBalance };
  const valid = positions.filter((p) => p.openedAt && (p.status === "closed" || p.status === "open"));

  // ---- the days to report: every UTC day of the window
  const firstKey = dayKey(windowStart);
  const lastKey = dayKey(windowEnd);
  const keys = [];
  for (let t = dayStart(firstKey); t <= dayStart(lastKey); t += DAY_MS) keys.push(dayKey(t));
  const days = new Map(keys.map((k) => [k, emptyDay(k, startingUsd)]));
  const dayOf = (k) => {
    if (!days.has(k)) days.set(k, emptyDay(k, startingUsd)); // a trade outside the window (should not happen) is still counted
    return days.get(k);
  };

  let curve = [];
  let unrealizedUsd = 0;
  let openCount = 0;
  for (const p of valid) {
    if (p.status === "open") {
      unrealizedUsd += p.unrealizedPnlUsd || 0;
      openCount += 1;
    }
  }

  let negativeEvents = 0;
  let maxNegativeDepth = 0;
  let lowestBalance = startingUsd;
  let notTaken = 0;
  let endBalance = startingUsd;
  /** Books a closed trade's result on a day: its P&L and win/loss. */
  let closedCount = 0;
  const book = (p, key) => {
    const d = dayOf(key);
    closedCount += 1;
    d.pnlUsd += p.realizedPnlUsd || 0;
    d.trades += 1;
    if ((p.realizedPnlUsd || 0) > 0) d.wins += 1;
    else if ((p.realizedPnlUsd || 0) < 0) d.losses += 1;
  };

  if (resetDaily) {
    // One independent wallet per entry day.
    const byEntryDay = new Map();
    for (const p of valid) {
      const k = dayKey(new Date(p.openedAt).getTime());
      if (!byEntryDay.has(k)) byEntryDay.set(k, []);
      byEntryDay.get(k).push(p);
    }
    for (const [key, group] of byEntryDay) {
      const d = dayOf(key);
      const res = walk(toEvents(group), cfg, null);
      d.endBalanceUsd = res.cash;
      d.lowestBalanceUsd = res.lowest;
      d.negativeEvents = res.negativeCount;
      d.maxNegativeDepthUsd = res.maxNegativeDepth;
      d.notTaken = res.refused.size;
      for (const p of group) if (p.status === "closed" && p.closedAt && !res.refused.has(p)) book(p, key);
      negativeEvents += res.negativeCount;
      maxNegativeDepth = Math.max(maxNegativeDepth, res.maxNegativeDepth);
      lowestBalance = Math.min(lowestBalance, res.lowest);
      notTaken += res.refused.size;
    }
    const lastDay = [...days.keys()].sort().at(-1);
    endBalance = days.get(lastDay)?.endBalanceUsd ?? startingUsd;
  } else {
    // One wallet through the whole window. Per day: the balance when it began, where it ended and its lowest point.
    const points = [];
    const touched = new Set(); // days that had at least one buy or sell
    let carried = startingUsd; // balance after the previous event
    const res = walk(toEvents(valid), cfg, (e, cash, flag) => {
      const key = dayKey(e.t);
      const d = dayOf(key);
      if (!touched.has(key)) {
        touched.add(key);
        d.startBalanceUsd = carried;
        d.lowestBalanceUsd = carried;
      }
      carried = cash;
      d.endBalanceUsd = cash;
      if (cash < d.lowestBalanceUsd) d.lowestBalanceUsd = cash;
      if (flag.negative) {
        d.negativeEvents += 1;
        d.maxNegativeDepthUsd = Math.max(d.maxNegativeDepthUsd, -cash);
      }
      if (flag.refused) d.notTaken += 1;
      else points.push({ t: e.t, balanceUsd: cash });
      if (e.order === 0 && e.p.status === "closed") book(e.p, key);
    });
    // A day with nothing happening keeps the balance the previous day ended on.
    let running = startingUsd;
    for (const k of [...days.keys()].sort()) {
      const d = days.get(k);
      if (touched.has(k)) running = d.endBalanceUsd;
      else {
        d.startBalanceUsd = running;
        d.endBalanceUsd = running;
        d.lowestBalanceUsd = running;
      }
    }
    negativeEvents = res.negativeCount;
    maxNegativeDepth = res.maxNegativeDepth;
    lowestBalance = res.lowest;
    notTaken = res.refused.size;
    endBalance = res.cash;
    curve = downsample([{ t: windowStart.getTime(), balanceUsd: startingUsd }, ...points]);
  }

  const dayList = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const realizedUsd = dayList.reduce((n, d) => n + d.pnlUsd, 0);
  const wins = dayList.reduce((n, d) => n + d.wins, 0);
  const losses = dayList.reduce((n, d) => n + d.losses, 0);
  return {
    wallet: {
      startingUsd,
      balanceUsd: endBalance, // uncommitted cash at the end (reset daily: where the last day ended)
      walletValueUsd: resetDaily ? null : startingUsd + realizedUsd + unrealizedUsd, // cash + open trades marked at the end of the window
      realizedPnlUsd: realizedUsd,
      unrealizedPnlUsd: unrealizedUsd,
      openPositionCount: openCount,
      closedPositionCount: closedCount,
      wins,
      losses,
      winRatePercent: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      negativeBalanceEventCount: negativeEvents,
      maxNegativeBalanceUsd: maxNegativeDepth,
      lowestBalanceUsd: lowestBalance,
      notTakenCount: notTaken,
      lossDays: dayList.filter((d) => d.trades > 0 && d.pnlUsd < 0).length,
      profitDays: dayList.filter((d) => d.pnlUsd > 0).length,
      negativeDays: dayList.filter((d) => d.negativeEvents > 0).length,
    },
    days: dayList,
    curve,
  };
}

/** The combined wallet of a run, for its page. null when the run is not a combined one. */
export async function getCombinedWallet(runId) {
  const run = await BacktestRun.findById(runId).lean();
  if (!run) return undefined;
  if (run.mode !== "combined" || !run.combined) return null;
  const [positions, unfinished] = await Promise.all([
    BacktestPosition.find({ runId: run._id, status: { $in: ["closed", "open"] } }, POSITION_FIELDS).lean(),
    BacktestRunTrader.countDocuments({ runId: run._id, stage: { $in: ["pending", "collecting", "simulating"] } }),
  ]);
  const ledger = buildCombinedLedger(positions, {
    startingUsd: run.combined.startingBalanceUsd,
    resetDaily: !!run.combined.resetDaily,
    allowNegativeBalance: run.combined.allowNegativeBalance !== false,
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
  });
  return {
    config: {
      startingBalanceUsd: run.combined.startingBalanceUsd,
      tradeAmountUsd: run.settings?.tradeSizeUsd ?? 0,
      resetDaily: !!run.combined.resetDaily,
      allowNegativeBalance: run.combined.allowNegativeBalance !== false,
      pumpFeePercent: run.settings?.pumpFeePercent ?? 0,
      jitoFeeUsd: run.settings?.jitoFeeUsd ?? 0,
    },
    ...ledger,
    // False while any address is still being worked on: the figures then cover only the trades simulated so far.
    complete: unfinished === 0 && run.status !== "queued",
  };
}
