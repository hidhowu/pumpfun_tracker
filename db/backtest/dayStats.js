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
