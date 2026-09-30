import { WalletDailySnapshot } from "./models/WalletDailySnapshot.js";
import { WalletPosition } from "./models/WalletPosition.js";
import { currentWalletValueUsd } from "./simulation/walletSnapshot.js";
import { todayUtcString } from "./simulation/snapshot.js";
import { computeStreaks } from "./pnl.js";

/** Wallet-scoped mirror of db/pnl.js's date helpers/computeDailyPnl/computeRangePnl - see that file for the actualized-vs-combined distinction this follows exactly. */

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

async function closedPnlForRange(filter, start, end) {
  const closedPositions = await WalletPosition.find({ ...filter, status: "closed", closedAt: { $gte: start, $lt: end } }).lean();
  const combinedUsd = closedPositions.reduce((sum, p) => sum + (p.realizedPnlUsd || 0), 0);
  const combinedPercent = closedPositions.reduce((sum, p) => sum + (p.realizedPnlPercent || 0), 0);
  const wins = closedPositions.filter((p) => (p.realizedPnlUsd || 0) > 0).length;
  const losses = closedPositions.filter((p) => (p.realizedPnlUsd || 0) < 0).length;
  return { combinedUsd, combinedPercent, closedTradeCount: closedPositions.length, wins, losses };
}

export async function computeWalletDailyPnl(walletId, dateStr, { currentValue } = {}) {
  const nextDateStr = addDaysUtc(dateStr, 1);
  const isToday = dateStr === todayUtcString();

  const [startSnap, endSnap] = await Promise.all([
    WalletDailySnapshot.findOne({ walletId, date: dateStr }).lean(),
    WalletDailySnapshot.findOne({ walletId, date: nextDateStr }).lean(),
  ]);

  const startValue = startSnap?.portfolioValueUsdAtOpen ?? null;
  let endValue = endSnap?.portfolioValueUsdAtOpen ?? null;
  if (endValue === null && isToday) {
    endValue = currentValue !== undefined ? currentValue : await currentWalletValueUsd(walletId);
  }

  const actualizedUsd = startValue !== null && endValue !== null ? endValue - startValue : null;
  const actualizedPercent = startValue ? (actualizedUsd / startValue) * 100 : null;

  const { start, end } = dayBoundsUtc(dateStr);
  const combined = await closedPnlForRange({ walletId }, start, end);

  // valueUsd (the day's end-of-day wallet value, startValue for a day still
  // missing its own snapshot) is what the performance chart plots - a clean
  // absolute time series, distinct from actualizedUsd (that day's delta).
  return { date: dateStr, valueUsd: endValue ?? startValue, actualizedUsd, actualizedPercent, ...combined };
}

/** Day-by-day breakdown for the last `days` days (inclusive of today), oldest first - drives the performance chart. */
export async function computeWalletDailyBreakdown(walletId, days) {
  const today = todayUtcString();
  const results = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = addDaysUtc(today, -i);
    results.push(await computeWalletDailyPnl(walletId, dateStr));
  }
  return results;
}

/** Aggregate performance over a range (days=1/7/30 for day/week/month), plus the daily breakdown and streaks. */
export async function computeWalletRangePnl(walletId, days) {
  const dailyBreakdown = await computeWalletDailyBreakdown(walletId, days);

  const firstWithStart = dailyBreakdown.find((d) => d.actualizedUsd !== null);
  const totalActualizedUsd = dailyBreakdown.reduce((sum, d) => sum + (d.actualizedUsd || 0), 0);
  const totalCombinedUsd = dailyBreakdown.reduce((sum, d) => sum + d.combinedUsd, 0);
  const totalCombinedPercent = dailyBreakdown.reduce((sum, d) => sum + d.combinedPercent, 0);
  const totalClosedTrades = dailyBreakdown.reduce((sum, d) => sum + d.closedTradeCount, 0);
  const totalWins = dailyBreakdown.reduce((sum, d) => sum + (d.wins || 0), 0);
  const totalLosses = dailyBreakdown.reduce((sum, d) => sum + (d.losses || 0), 0);

  return {
    days,
    actualizedUsd: firstWithStart ? totalActualizedUsd : null,
    combinedUsd: totalCombinedUsd,
    combinedPercent: totalCombinedPercent,
    closedTradeCount: totalClosedTrades,
    wins: totalWins,
    losses: totalLosses,
    winRatePercent: totalWins + totalLosses > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : null,
    dailyBreakdown,
    streaks: computeStreaks(dailyBreakdown),
  };
}

/**
 * Per-trader-within-wallet P&L over a trailing period (days=1/7/30) - for
 * the wallet's "Traders Performance" tab. Scoped to closed WalletPosition
 * rows for THIS trader on THIS wallet only - never the trader's overall/
 * lifetime stats elsewhere in the app. A trader added to a wallet starts at
 * zero here regardless of how they've done anywhere else.
 */
export async function computeWalletTraderPnl(walletId, traderAddress, days) {
  const today = todayUtcString();
  const start = new Date(`${addDaysUtc(today, -(days - 1))}T00:00:00.000Z`);
  const end = new Date(`${addDaysUtc(today, 1)}T00:00:00.000Z`);
  return closedPnlForRange({ walletId, traderAddress }, start, end);
}
