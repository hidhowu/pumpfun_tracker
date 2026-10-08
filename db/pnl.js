import { DailySnapshot } from "./models/DailySnapshot.js";
import { SimPosition } from "./models/SimPosition.js";
import { currentPortfolioValueUsd, todayUtcString } from "./simulation/snapshot.js";

/**
 * Two distinct P&L metrics, computed per day (and rolled up to week/month):
 *
 * - "actualized": start-of-day portfolio value (balance + unrealized value
 *   of open positions) vs end-of-day portfolio value. This is what the
 *   trader's simulated wallet was actually worth, including positions
 *   still open.
 * - "combined": the arithmetic SUM of each individually-closed trade's %
 *   return within the period (e.g. +50% and +30% and -10% closed trades on
 *   the same day = "70% combined" for that day) - realized trades only,
 *   never includes anything still open. This is intentionally NOT a
 *   compounded/weighted return; it's a skill signal ("were their closed
 *   decisions net positive"), separate from actualized, which is exposed
 *   to whatever they're still holding.
 */

function addDaysUtc(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayBoundsUtc(dateStr) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${addDaysUtc(dateStr, 1)}T00:00:00.000Z`);
  return { start, end };
}

async function combinedPnlForRange(profileId, traderAddress, start, end) {
  const closedPositions = await SimPosition.find({
    profileId,
    traderAddress,
    status: "closed",
    closedAt: { $gte: start, $lt: end },
  }).lean();

  const combinedPercent = closedPositions.reduce((sum, p) => sum + (p.realizedPnlPercent || 0), 0);
  const combinedUsd = closedPositions.reduce((sum, p) => sum + (p.realizedPnlUsd || 0), 0);
  const wins = closedPositions.filter((p) => (p.realizedPnlUsd || 0) > 0).length;
  const losses = closedPositions.filter((p) => (p.realizedPnlUsd || 0) < 0).length;
  return { combinedUsd, combinedPercent, closedTradeCount: closedPositions.length, wins, losses };
}

/**
 * Actualized + combined P&L for exactly one UTC calendar day. `currentValue`
 * lets a caller that has already fetched today's live portfolio value
 * (walletValueUsd - balance + mark-to-market of open positions) pass it in,
 * so this doesn't re-fetch prices for the same trader a second time.
 */
export async function computeDailyPnl(profileId, traderAddress, dateStr, { currentValue } = {}) {
  const nextDateStr = addDaysUtc(dateStr, 1);
  const isToday = dateStr === todayUtcString();

  const [startSnap, endSnap] = await Promise.all([
    DailySnapshot.findOne({ profileId, traderAddress, date: dateStr }).lean(),
    DailySnapshot.findOne({ profileId, traderAddress, date: nextDateStr }).lean(),
  ]);

  const startValue = startSnap?.portfolioValueUsdAtOpen ?? null;
  let endValue = endSnap?.portfolioValueUsdAtOpen ?? null;
  if (endValue === null && isToday) {
    endValue = currentValue !== undefined ? currentValue : await currentPortfolioValueUsd(profileId, traderAddress);
  }

  const actualizedUsd = startValue !== null && endValue !== null ? endValue - startValue : null;
  const actualizedPercent = startValue ? (actualizedUsd / startValue) * 100 : null;

  const { start, end } = dayBoundsUtc(dateStr);
  const combined = await combinedPnlForRange(profileId, traderAddress, start, end);

  return { date: dateStr, actualizedUsd, actualizedPercent, ...combined };
}

/**
 * Cheap "today" snapshot for a trader, meant for a list view polled
 * frequently across many traders: no heavier than computeDailyPnl already
 * is (one indexed SimPosition query + the same actualized-value lookup
 * used everywhere else), just packaged with a win rate for display. Pass
 * `currentValue` if the caller already has today's live portfolio value
 * (e.g. for walletValueUsd) to avoid fetching prices twice.
 */
export async function computeTodayQuickStats(profileId, traderAddress, { currentValue } = {}) {
  const today = todayUtcString();
  const day = await computeDailyPnl(profileId, traderAddress, today, { currentValue });
  const decided = day.wins + day.losses;
  const winRatePercent = decided > 0 ? (day.wins / decided) * 100 : null;
  return { ...day, winRatePercent };
}

/** Day-by-day breakdown for the last `days` days (inclusive of today), oldest first. */
export async function computeDailyBreakdown(profileId, traderAddress, days) {
  const today = todayUtcString();
  const results = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = addDaysUtc(today, -i);
    results.push(await computeDailyPnl(profileId, traderAddress, dateStr));
  }
  return results;
}

function classifyDay(day) {
  if (day.closedTradeCount === 0 || day.combinedPercent === 0) return "neutral";
  return day.combinedPercent > 0 ? "profit" : "loss";
}

/** Longest and current consecutive-day streaks, and profitable/loss day counts, from a daily breakdown array (oldest first). */
export function computeStreaks(dailyBreakdown) {
  let profitableDays = 0;
  let lossDays = 0;
  let longestProfitStreak = 0;
  let longestLossStreak = 0;
  let runType = null;
  let runLength = 0;

  for (const day of dailyBreakdown) {
    const type = classifyDay(day);
    if (type === "profit") profitableDays += 1;
    if (type === "loss") lossDays += 1;

    if (type === runType) {
      runLength += 1;
    } else {
      runType = type;
      runLength = type === "neutral" ? 0 : 1;
    }
    if (runType === "profit") longestProfitStreak = Math.max(longestProfitStreak, runLength);
    if (runType === "loss") longestLossStreak = Math.max(longestLossStreak, runLength);
  }

  // Current streak: walk back from the most recent day.
  let currentStreakType = "none";
  let currentStreakLength = 0;
  for (let i = dailyBreakdown.length - 1; i >= 0; i--) {
    const type = classifyDay(dailyBreakdown[i]);
    if (type === "neutral") break;
    if (currentStreakType === "none") currentStreakType = type;
    if (type !== currentStreakType) break;
    currentStreakLength += 1;
  }

  return {
    profitableDays,
    lossDays,
    neutralDays: dailyBreakdown.length - profitableDays - lossDays,
    longestProfitStreak,
    longestLossStreak,
    currentStreak: { type: currentStreakType, length: currentStreakLength },
  };
}

/**
 * computeRangePnl for many traders at once, from 2 queries total instead of
 * ~3 per day per trader (a 30-day leaderboard over 100 traders was ~9,000
 * sequential-ish queries). `currentValueByAddress` supplies today's live
 * portfolio value per trader (for today's actualized P&L); a trader missing
 * from it just gets a null actualized figure for today. Same output shape
 * as computeRangePnl, keyed by address.
 */
export async function computeRangePnlBatch(profileId, addresses, days, { currentValueByAddress = new Map() } = {}) {
  const today = todayUtcString();
  const dates = Array.from({ length: days }, (_, i) => addDaysUtc(today, -(days - 1 - i)));
  const rangeStart = new Date(`${dates[0]}T00:00:00.000Z`);
  const rangeEnd = dayBoundsUtc(today).end;

  const [snapshots, closed] = await Promise.all([
    DailySnapshot.find(
      { profileId, traderAddress: { $in: addresses }, date: { $gte: dates[0], $lte: addDaysUtc(today, 1) } },
      { traderAddress: 1, date: 1, portfolioValueUsdAtOpen: 1 }
    ).lean(),
    SimPosition.find(
      { profileId, traderAddress: { $in: addresses }, status: "closed", closedAt: { $gte: rangeStart, $lt: rangeEnd } },
      { traderAddress: 1, closedAt: 1, realizedPnlUsd: 1, realizedPnlPercent: 1 }
    ).lean(),
  ]);

  const snapValue = new Map(snapshots.map((s) => [`${s.traderAddress}|${s.date}`, s.portfolioValueUsdAtOpen]));
  const closedByKey = new Map();
  for (const p of closed) {
    const key = `${p.traderAddress}|${new Date(p.closedAt).toISOString().slice(0, 10)}`;
    if (!closedByKey.has(key)) closedByKey.set(key, []);
    closedByKey.get(key).push(p);
  }

  const result = new Map();
  for (const address of addresses) {
    const dailyBreakdown = dates.map((date) => {
      const startValue = snapValue.get(`${address}|${date}`) ?? null;
      let endValue = snapValue.get(`${address}|${addDaysUtc(date, 1)}`) ?? null;
      if (endValue === null && date === today) endValue = currentValueByAddress.get(address) ?? null;
      const actualizedUsd = startValue !== null && endValue !== null ? endValue - startValue : null;
      const dayClosed = closedByKey.get(`${address}|${date}`) || [];
      return {
        date,
        actualizedUsd,
        actualizedPercent: startValue ? (actualizedUsd / startValue) * 100 : null,
        combinedUsd: dayClosed.reduce((sum, p) => sum + (p.realizedPnlUsd || 0), 0),
        combinedPercent: dayClosed.reduce((sum, p) => sum + (p.realizedPnlPercent || 0), 0),
        closedTradeCount: dayClosed.length,
        wins: dayClosed.filter((p) => (p.realizedPnlUsd || 0) > 0).length,
        losses: dayClosed.filter((p) => (p.realizedPnlUsd || 0) < 0).length,
      };
    });
    result.set(address, summarizeRange(dailyBreakdown, days));
  }
  return result;
}

function summarizeRange(dailyBreakdown, days) {
  const firstWithStart = dailyBreakdown.find((d) => d.actualizedUsd !== null);
  const totalClosedTrades = dailyBreakdown.reduce((sum, d) => sum + d.closedTradeCount, 0);
  const totalWins = dailyBreakdown.reduce((sum, d) => sum + (d.wins || 0), 0);
  const totalLosses = dailyBreakdown.reduce((sum, d) => sum + (d.losses || 0), 0);
  return {
    days,
    actualizedUsd: firstWithStart ? dailyBreakdown.reduce((sum, d) => sum + (d.actualizedUsd || 0), 0) : null,
    combinedUsd: dailyBreakdown.reduce((sum, d) => sum + d.combinedUsd, 0),
    combinedPercent: dailyBreakdown.reduce((sum, d) => sum + d.combinedPercent, 0),
    closedTradeCount: totalClosedTrades,
    wins: totalWins,
    losses: totalLosses,
    winRatePercent: totalWins + totalLosses > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : null,
    averageTradesPerDay: totalClosedTrades / days,
    dailyBreakdown,
    streaks: computeStreaks(dailyBreakdown),
  };
}

/** Aggregate actualized + combined P&L across a range, plus the day-by-day breakdown and streaks. Use days=7 for "weekly", 30 for "monthly". */
export async function computeRangePnl(profileId, traderAddress, days) {
  const dailyBreakdown = await computeDailyBreakdown(profileId, traderAddress, days);
  return summarizeRange(dailyBreakdown, days);
}
