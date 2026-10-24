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
 * The deepest the balance went, as a number to size your nerve against: "how much can I be down at one time and still stick with this?"
 *
 * It does not depend on days. The closed trades are put in the order they closed, and for EVERY trade the question is asked as if trading
 * had started right there: after that trade and each one that follows, where is the running total, and what is the lowest it gets to?
 *
 *   trades  +20  -5  +8  -7  +1  -15  +20  +20
 *   from trade 1: running total 20, 15, 23, 16, 17, 2, 22, 42   -> lowest +2
 *   from trade 2: -5, 3, -4, -3, -18, 2, 22                     -> lowest -18
 *   from trade 3: 8, 1, 2, -13, 7, 27                           -> lowest -13
 *   from trade 4: -7, -6, -21, -1, 19                           -> lowest -21     <- the deepest point
 *
 * The deepest point is the lowest of those lowest points. (It is the biggest fall from any high to a later low: the +23 after trade 3 to
 * the +2 after trade 6.) `depths` holds every starting trade's lowest point that is below zero, so the page can answer "from how many
 * starting trades did the balance go down at least this far" for any level, which is what "times reached" means here.
 *
 * Only closed trades count (an open trade has no result yet). Percentages are a share of `startingUsd`.
 *
 * @param {Array<{t: number, pnlUsd: number}>} trades closed trades, any order; `t` = close time in ms
 * @param {{startingUsd?: number}} [opts]
 * @returns {{ startingUsd: number, trades: number, belowZero: number,
 *   lowest: {pnlUsd: number, percent: number, startTrade: number, startAt: number, troughTrade: number, troughAt: number} | null,
 *   depths: number[] }} startTrade / troughTrade are 1-based positions in closing order; depths ascending (deepest first), cents
 */
export function lossDepthView(trades, { startingUsd = 0 } = {}) {
  const sorted = [...trades].sort((a, b) => a.t - b.t);
  const n = sorted.length;
  const total = new Array(n + 1); // total[m] = running total after the first m trades
  total[0] = 0;
  for (let i = 0; i < n; i++) total[i + 1] = total[i] + (sorted[i].pnlUsd || 0);

  // lowestAfter[m] = the lowest running total from m trades on (index of it in lowestAt[m]).
  const lowestAfter = new Array(n + 2).fill(Infinity);
  const lowestAt = new Array(n + 2).fill(-1);
  for (let m = n; m >= 1; m--) {
    if (total[m] < lowestAfter[m + 1]) {
      lowestAfter[m] = total[m];
      lowestAt[m] = m;
    } else {
      lowestAfter[m] = lowestAfter[m + 1];
      lowestAt[m] = lowestAt[m + 1];
    }
  }

  const depths = [];
  let best = null;
  for (let k = 0; k < n; k++) {
    const depth = lowestAfter[k + 1] - total[k]; // started at trade k+1
    if (depth < 0) {
      depths.push(Math.round(depth * 100) / 100);
      if (!best || depth < best.depth) best = { depth, k, trough: lowestAt[k + 1] };
    }
  }
  depths.sort((a, b) => a - b);

  const lowest = best
    ? {
        pnlUsd: best.depth,
        percent: startingUsd > 0 ? (best.depth / startingUsd) * 100 : 0,
        startTrade: best.k + 1,
        startAt: sorted[best.k].t,
        troughTrade: best.trough,
        troughAt: sorted[best.trough - 1].t,
      }
    : null;
  return { startingUsd, trades: n, belowZero: depths.length, lowest, depths };
}

const DAY_MS = 86_400_000;
const dateKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The worst stretch of days in a row: every window of `length` consecutive calendar days (days 1-7, then 2-8, then 3-9 ...) is added up,
 * and the window with the lowest total is the worst one. A day with no trade is a day with 0 in it - it still takes its place in the row.
 * A stretch needs all `length` days inside the window, so a run shorter than that has none.
 *
 * A day's result is the day's `pnlUsd` exactly as the daily breakdown shows it. Percentages are a share of `startingUsd`.
 *
 * @param {Array<{date: string, pnlUsd: number, trades?: number}>} days one entry per UTC day, any order
 * @param {{length?: number, startingUsd?: number}} [opts]
 * @returns {{ length: number, startingUsd: number, dayCount: number, windows: number, belowZero: number,
 *   worst: {startDate: string, endDate: string, pnlUsd: number, percent: number, trades: number, lossDays: number,
 *     days: Array<{date: string, pnlUsd: number, trades: number}>} | null }}
 *   belowZero = how many of the windows added up to a loss; worst = null when there are fewer than `length` days
 */
export function worstStretchView(days, { length = 7, startingUsd = 0 } = {}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const keys = [...byDate.keys()].sort();
  const row = []; // every calendar day from the first to the last, gaps filled with an empty day
  if (keys.length) {
    for (let t = Date.parse(`${keys[0]}T00:00:00Z`); t <= Date.parse(`${keys.at(-1)}T00:00:00Z`); t += DAY_MS) {
      const key = dateKey(t);
      const d = byDate.get(key);
      row.push({ date: key, pnlUsd: d?.pnlUsd || 0, trades: d?.trades || 0 });
    }
  }

  const windows = Math.max(0, row.length - length + 1);
  if (windows === 0) return { length, startingUsd, dayCount: row.length, windows: 0, belowZero: 0, worst: null };

  let sum = 0;
  for (let i = 0; i < length; i++) sum += row[i].pnlUsd;
  let belowZero = 0;
  let worstAt = 0;
  let worstSum = sum;
  for (let i = 0; i < windows; i++) {
    if (i > 0) sum += row[i + length - 1].pnlUsd - row[i - 1].pnlUsd;
    if (sum < -1e-9) belowZero += 1;
    if (sum < worstSum - 1e-9) {
      worstSum = sum;
      worstAt = i;
    }
  }

  const picked = row.slice(worstAt, worstAt + length);
  const pnlUsd = picked.reduce((n, d) => n + d.pnlUsd, 0); // re-added directly, so the running sum's float drift never reaches the page
  return {
    length,
    startingUsd,
    dayCount: row.length,
    windows,
    belowZero,
    worst: {
      startDate: picked[0].date,
      endDate: picked.at(-1).date,
      pnlUsd,
      percent: startingUsd > 0 ? (pnlUsd / startingUsd) * 100 : 0,
      trades: picked.reduce((n, d) => n + d.trades, 0),
      lossDays: picked.filter((d) => d.pnlUsd < 0).length,
      days: picked,
    },
  };
}
