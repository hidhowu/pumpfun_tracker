/**
 * Day-by-day quality figures for one backtested trader, built from its daily results (a day = a UTC day on which at least
 * one trade closed; `pct` is the sum of that day's closed trades' percent results - the "combined %" of the daily breakdown).
 *
 *  lossDays            days that closed with a net loss
 *  profitDaysPercent   profit days / trading days * 100 (3 profitable days of 7 -> 43%); null = no trading day yet
 *  avgPnlPerDayUsd     the dollar P&L over all trading days / trading days; null = no trading day yet
 *  profitMarginPercent how much of the trader's profit is left after its losses:
 *                        (profitDaysTotal - lossDaysTotal) / profitDaysTotal * 100
 *                      +100 and -20 over two days -> (100 - 20) / 100 = 80%. 100% = no losing day at all; 0% = the losses ate
 *                      all the profit; below 0 = losing overall. Read it as "losses are (100 - margin)% of the profit": a margin
 *                      of 10% means the losing days cost 90% of what the winning days made. null = no profitable day yet.
 *  withoutBestDay      the same figures with the single most profitable day removed, as if the trader had not traded that day -
 *                      tells a steady trader from one lucky day.
 */

/** @param {Array<{date: string, pnlUsd: number, pct: number}>} days */
function figures(days) {
  let profit = 0;
  let loss = 0;
  let lossDays = 0;
  let pnlUsd = 0;
  let pct = 0;
  for (const d of days) {
    pnlUsd += d.pnlUsd;
    pct += d.pct;
    if (d.pct > 0) profit += d.pct;
    else if (d.pct < 0) {
      loss += -d.pct;
    }
    if (d.pnlUsd < 0) lossDays += 1;
  }
  return { profit, loss, lossDays, pnlUsd, pct, margin: profit > 0 ? ((profit - loss) / profit) * 100 : null };
}

export function summariseDays(days) {
  const all = figures(days);
  const profitDays = days.filter((d) => d.pnlUsd > 0).length;

  let best = null;
  for (const d of days) if (!best || d.pct > best.pct || (d.pct === best.pct && d.pnlUsd > best.pnlUsd)) best = d;

  let without = null;
  if (best && days.length > 1) {
    const rest = figures(days.filter((d) => d !== best));
    without = { combinedPercent: rest.pct, pnlUsd: rest.pnlUsd, lossDays: rest.lossDays, profitMarginPercent: rest.margin, stillProfitable: rest.pnlUsd > 0 && rest.pct > 0 };
  } else if (best) {
    without = { combinedPercent: 0, pnlUsd: 0, lossDays: 0, profitMarginPercent: null, stillProfitable: false }; // the only day removed: nothing left
  }

  return {
    tradingDays: days.length,
    lossDays: all.lossDays,
    profitDays,
    profitDaysPercent: days.length > 0 ? (profitDays / days.length) * 100 : null,
    avgPnlPerDayUsd: days.length > 0 ? all.pnlUsd / days.length : null,
    grossProfitPercent: all.profit,
    grossLossPercent: all.loss,
    profitMarginPercent: all.margin,
    bestDay: best ? { date: best.date, pnlUsd: best.pnlUsd, percent: best.pct } : null,
    withoutBestDay: without,
  };
}

/**
 * How deep the losses went, as opposed to how a day ended. A day that closes at +20 may have been at -80 an hour earlier, and the
 * daily total hides that. Here the closed trades are walked in the order they closed and the running P&L is followed, with no
 * boundaries: if it fell to -120, climbed back, and later fell to -121, the deepest point is -121.
 *
 *  lowest        the deepest point the running P&L reached over the whole time frame (null = it never went below zero). With
 *                `resetEachDay` every day is its own wallet that starts again at 0, so this is the worst day's low instead.
 *  deepestDay    the lowest point any single day reached on its own (a day starts at 0): +20 at the end of a day that touched -80
 *                reads as -80 here.
 *  days          per day: the lowest point it reached (0 = never below zero), where it ended, and how many trades closed.
 *  swings        the running P&L reduced to its turning points (every peak and trough, nothing in between). That is all that is needed
 *                to count how many times it dropped to any level: see countReaches() in lib/loss-depth.ts.
 *
 * Only closed trades count (an open trade has no result yet), so the figures are of realised results. Percentages are a share of
 * `startingUsd`.
 *
 * @param {Array<{t: number, day: string, pnlUsd: number}>} trades closed trades, any order; `t` = close time in ms, `day` = the day it is booked on
 * @param {{startingUsd?: number, resetEachDay?: boolean}} [opts]
 */
export function lossDepthView(trades, { startingUsd = 0, resetEachDay = false } = {}) {
  const sorted = [...trades].sort((a, b) => a.t - b.t);
  const ofStart = (usd) => (startingUsd > 0 ? (usd / startingUsd) * 100 : 0);

  const byDay = new Map();
  const raw = sorted.length ? [{ t: sorted[0].t, pnlUsd: 0 }] : [];
  let run = 0;
  let overall = null;
  let currentDay = null;
  for (const trade of sorted) {
    if (resetEachDay && currentDay !== null && trade.day !== currentDay) {
      run = 0;
      raw.push({ t: trade.t, pnlUsd: 0 });
    }
    currentDay = trade.day;
    run += trade.pnlUsd || 0;
    raw.push({ t: trade.t, pnlUsd: run });
    if (run < 0 && (!overall || run < overall.pnlUsd)) overall = { pnlUsd: run, at: trade.t };

    let d = byDay.get(trade.day);
    if (!d) {
      d = { lowestPnlUsd: 0, lowestPnlAt: null, endPnlUsd: 0, trades: 0 };
      byDay.set(trade.day, d);
    }
    d.endPnlUsd += trade.pnlUsd || 0;
    d.trades += 1;
    if (d.endPnlUsd < d.lowestPnlUsd) {
      d.lowestPnlUsd = d.endPnlUsd;
      d.lowestPnlAt = trade.t;
    }
  }

  const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, d]) => ({ date, ...d }));
  let worstDay = null;
  for (const d of days) if (d.lowestPnlUsd < 0 && (!worstDay || d.lowestPnlUsd < worstDay.lowestPnlUsd)) worstDay = d;
  const deepestDay = worstDay ? { date: worstDay.date, pnlUsd: worstDay.lowestPnlUsd, percent: ofStart(worstDay.lowestPnlUsd), at: worstDay.lowestPnlAt } : null;

  let lowest = overall ? { pnlUsd: overall.pnlUsd, percent: ofStart(overall.pnlUsd), at: overall.at } : null;
  if (resetEachDay) lowest = deepestDay ? { pnlUsd: deepestDay.pnlUsd, percent: deepestDay.percent, at: deepestDay.at } : null;

  // Turning points only: a run of rising (or falling) points collapses into its last one, equal values into one.
  const swings = [];
  for (const point of raw) {
    const last = swings.at(-1);
    if (last && last.pnlUsd === point.pnlUsd) continue;
    const before = swings.at(-2);
    if (before && last && (last.pnlUsd - before.pnlUsd) * (point.pnlUsd - last.pnlUsd) > 0) swings[swings.length - 1] = point;
    else swings.push(point);
  }

  return { startingUsd, resetDaily: resetEachDay, lowest, deepestDay, days, swings };
}
