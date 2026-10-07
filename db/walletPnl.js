import { WalletDailySnapshot } from "./models/WalletDailySnapshot.js";
import { WalletHourlySnapshot } from "./models/WalletHourlySnapshot.js";
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

/** Day-by-day breakdown for the `days` days ending on `endDate` (default today), oldest first - drives the performance chart. */
export async function computeWalletDailyBreakdown(walletId, days, { endDate = todayUtcString(), currentValue } = {}) {
  const results = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = addDaysUtc(endDate, -i);
    results.push(await computeWalletDailyPnl(walletId, dateStr, { currentValue }));
  }
  return results;
}

/**
 * Hour-by-hour breakdown of one UTC day (24 buckets, 00:00-24:00) - drives the
 * "Day" view of the performance chart.
 *
 * pnlUsd/tradeCount/wins/losses are the REALIZED figures for trades that
 * closed in that hour (same definition as the daily chart's combinedUsd).
 *
 * valueUsd is the wallet's value during that hour: the hourly snapshot
 * (WalletHourlySnapshot) when one exists, the live value for the hour in
 * progress, and otherwise - for hours that predate hourly snapshots - an
 * ESTIMATE (valueEstimated: true) of the day's opening value plus realized P&L
 * since, which can't see unrealized moves. Hours still in the future, or
 * before any baseline exists, are null.
 */
export async function computeWalletHourlyBreakdown(walletId, dateStr, { currentValue } = {}) {
  const { start, end } = dayBoundsUtc(dateStr);
  const isToday = dateStr === todayUtcString();
  const currentHour = isToday ? new Date().getUTCHours() : 24;

  const [closed, hourSnaps, daySnap] = await Promise.all([
    WalletPosition.find(
      { walletId, status: "closed", closedAt: { $gte: start, $lt: end } },
      { closedAt: 1, realizedPnlUsd: 1 }
    ).lean(),
    WalletHourlySnapshot.find({ walletId, hour: { $gte: `${dateStr}T00`, $lt: `${addDaysUtc(dateStr, 1)}T00` } }).lean(),
    WalletDailySnapshot.findOne({ walletId, date: dateStr }).lean(),
  ]);

  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    pnlUsd: 0,
    tradeCount: 0,
    wins: 0,
    losses: 0,
  }));
  for (const p of closed) {
    const bucket = hours[new Date(p.closedAt).getUTCHours()];
    const pnl = p.realizedPnlUsd || 0;
    bucket.pnlUsd += pnl;
    bucket.tradeCount += 1;
    if (pnl > 0) bucket.wins += 1;
    else if (pnl < 0) bucket.losses += 1;
  }

  const snapByHour = new Map(hourSnaps.map((s) => [Number(s.hour.slice(11, 13)), s.valueUsd]));
  // The day-open snapshot may have been self-healed mid-day, so it only vouches
  // for the wallet's value from the moment it was created onward.
  const baseline = daySnap ? daySnap.portfolioValueUsdAtOpen : null;
  const baselineAt = daySnap ? new Date(daySnap.createdAt) : null;

  let cumulativePnlUsd = 0;
  for (const bucket of hours) {
    cumulativePnlUsd += bucket.pnlUsd;
    bucket.cumulativePnlUsd = bucket.hour > currentHour ? null : cumulativePnlUsd;

    const hourEnd = new Date(start.getTime() + (bucket.hour + 1) * 3600000);
    const realizedSinceBaseline = baselineAt
      ? closed.reduce((sum, p) => (new Date(p.closedAt) > baselineAt && new Date(p.closedAt) < hourEnd ? sum + (p.realizedPnlUsd || 0) : sum), 0)
      : 0;

    bucket.valueEstimated = false;
    if (bucket.hour > currentHour) {
      bucket.valueUsd = null;
    } else if (isToday && bucket.hour === currentHour && currentValue !== undefined) {
      bucket.valueUsd = currentValue; // live beats the hour's snapshot, which can be up to an hour old
    } else if (snapByHour.has(bucket.hour)) {
      bucket.valueUsd = snapByHour.get(bucket.hour);
    } else if (baseline !== null && hourEnd > baselineAt) {
      bucket.valueUsd = baseline + realizedSinceBaseline;
      bucket.valueEstimated = true;
    } else {
      bucket.valueUsd = null;
    }
  }

  return hours;
}

/** Aggregate performance over a range (days=1/7/30 for day/week/month), plus the daily breakdown and streaks. */
export async function computeWalletRangePnl(walletId, days, { endDate, currentValue } = {}) {
  const dailyBreakdown = await computeWalletDailyBreakdown(walletId, days, { endDate, currentValue });

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

/**
 * Every trader assigned to the wallet, broken down day by day for the last
 * `days` UTC days (default 7, today included, oldest first): realized P&L and
 * trade count per day. Same scoping as computeWalletTraderPnl - only closed
 * WalletPositions on THIS wallet - so it drives the detailed "Traders
 * Performance" matrix. Returns { dates, traders: { [address]: day[] } }, where
 * every trader that traded in the window has an entry for every date.
 */
export async function computeWalletTradersDailyPnl(walletId, days = 7) {
  const today = todayUtcString();
  const dates = Array.from({ length: days }, (_, i) => addDaysUtc(today, -(days - 1 - i)));
  const start = new Date(`${dates[0]}T00:00:00.000Z`);
  const end = dayBoundsUtc(today).end;

  const closed = await WalletPosition.find(
    { walletId, status: "closed", closedAt: { $gte: start, $lt: end } },
    { traderAddress: 1, closedAt: 1, realizedPnlUsd: 1 }
  ).lean();

  const byTrader = {};
  for (const p of closed) {
    const row = (byTrader[p.traderAddress] ||= dates.map((date) => ({ date, pnlUsd: 0, tradeCount: 0, wins: 0, losses: 0 })));
    const day = row[dates.indexOf(new Date(p.closedAt).toISOString().slice(0, 10))];
    if (!day) continue;
    const pnl = p.realizedPnlUsd || 0;
    day.pnlUsd += pnl;
    day.tradeCount += 1;
    if (pnl > 0) day.wins += 1;
    else if (pnl < 0) day.losses += 1;
  }
  return { dates, traders: byTrader };
}
