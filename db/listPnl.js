import mongoose from "mongoose";
import { Trader } from "./models/Trader.js";
import { TraderList } from "./models/TraderList.js";
import { ProfileTrader } from "./models/ProfileTrader.js";
import { SimPosition } from "./models/SimPosition.js";
import { DailySnapshot } from "./models/DailySnapshot.js";
import { todayUtcString } from "./simulation/snapshot.js";
import { getPrice, prefetchPrices } from "./pumpFunApi.js";
import { computeStreaks } from "./pnl.js";

/**
 * Combined performance of every trader tagged into a TraderList, within ONE
 * profile. Unlike a wallet (which only counts trades made since a trader was
 * added to it), a list is a lens over the traders' whole history on that
 * profile: every closed SimPosition and every DailySnapshot they have there.
 * Output shapes deliberately mirror db/walletPnl.js so the wallet chart
 * components render them unchanged.
 */

function addDaysUtc(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayBoundsUtc(dateStr) {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  return { start, end: new Date(`${addDaysUtc(dateStr, 1)}T00:00:00.000Z`) };
}

const isoDay = (date) => new Date(date).toISOString().slice(0, 10);

export async function getListAddresses(listId) {
  const traders = await Trader.find({ listIds: listId }, { address: 1 }).lean();
  return traders.map((t) => t.address);
}

/** Balance + live mark-to-market value of every open position, summed over the given traders. Prices are fetched once per distinct mint. */
export async function currentListValueUsd(profileId, addresses) {
  if (addresses.length === 0) return 0;
  const [profileTraders, openPositions] = await Promise.all([
    ProfileTrader.find({ profileId, traderAddress: { $in: addresses } }, { "sim.balanceUsd": 1 }).lean(),
    SimPosition.find({ profileId, traderAddress: { $in: addresses }, status: "open" }, { mint: 1, tokenAmount: 1, costBasisUsd: 1 }).lean(),
  ]);
  await prefetchPrices(openPositions.map((p) => p.mint));
  const openValues = await Promise.all(
    openPositions.map(async (p) => {
      const price = await getPrice(p.mint);
      return price?.priceUsd ? p.tokenAmount * price.priceUsd : p.costBasisUsd;
    })
  );
  const balances = profileTraders.reduce((sum, pt) => sum + (pt.sim?.balanceUsd || 0), 0);
  return balances + openValues.reduce((sum, v) => sum + v, 0);
}

/**
 * Returns totalAt(date): the summed start-of-day portfolio value of the
 * traders. A trader missing a snapshot for a date borrows its nearest earlier
 * one (or, before its first snapshot, its first one), so a trader that only
 * started being tracked mid-range reads as flat rather than as a phantom jump.
 * null when none of the traders has any snapshot.
 */
async function loadValueLookup(profileId, addresses) {
  const snaps = await DailySnapshot.find(
    { profileId, traderAddress: { $in: addresses } },
    { traderAddress: 1, date: 1, portfolioValueUsdAtOpen: 1 }
  )
    .sort({ date: 1 })
    .lean();
  const byTrader = new Map();
  for (const s of snaps) {
    if (!byTrader.has(s.traderAddress)) byTrader.set(s.traderAddress, []);
    byTrader.get(s.traderAddress).push([s.date, s.portfolioValueUsdAtOpen]);
  }
  const series = [...byTrader.values()];
  return (date) => {
    if (series.length === 0) return null;
    let total = 0;
    for (const rows of series) {
      let value = rows[0][1];
      for (const [d, v] of rows) {
        if (d > date) break;
        value = v;
      }
      total += value;
    }
    return total;
  };
}

function closedFilter(profileId, addresses, start, end) {
  return { profileId, traderAddress: { $in: addresses }, status: "closed", closedAt: { $gte: start, $lt: end } };
}

function tally(positions) {
  const wins = positions.filter((p) => (p.realizedPnlUsd || 0) > 0).length;
  const losses = positions.filter((p) => (p.realizedPnlUsd || 0) < 0).length;
  return {
    combinedUsd: positions.reduce((sum, p) => sum + (p.realizedPnlUsd || 0), 0),
    combinedPercent: positions.reduce((sum, p) => sum + (p.realizedPnlPercent || 0), 0),
    closedTradeCount: positions.length,
    wins,
    losses,
  };
}

/** Day-by-day breakdown for the `days` days ending on `endDate`, oldest first - same shape as computeWalletDailyBreakdown. */
async function computeListDailyBreakdown(profileId, addresses, days, { endDate, currentValue }) {
  const today = todayUtcString();
  const dates = Array.from({ length: days }, (_, i) => addDaysUtc(endDate, -(days - 1 - i)));
  const [valueAt, closed] = await Promise.all([
    loadValueLookup(profileId, addresses),
    SimPosition.find(closedFilter(profileId, addresses, dayBoundsUtc(dates[0]).start, dayBoundsUtc(endDate).end), {
      closedAt: 1,
      realizedPnlUsd: 1,
      realizedPnlPercent: 1,
    }).lean(),
  ]);

  const closedByDate = new Map();
  for (const p of closed) {
    const key = isoDay(p.closedAt);
    if (!closedByDate.has(key)) closedByDate.set(key, []);
    closedByDate.get(key).push(p);
  }

  return dates.map((date) => {
    const startValue = valueAt(date);
    const endValue = date === today ? (currentValue ?? null) : valueAt(addDaysUtc(date, 1));
    const actualizedUsd = startValue !== null && endValue !== null ? endValue - startValue : null;
    return {
      date,
      valueUsd: endValue ?? startValue,
      actualizedUsd,
      actualizedPercent: startValue ? (actualizedUsd / startValue) * 100 : null,
      ...tally(closedByDate.get(date) || []),
    };
  });
}

/**
 * Hour-by-hour breakdown of one UTC day. There are no hourly snapshots for
 * profile traders, so valueUsd is always day-open value + realized P&L so far
 * (valueEstimated: true), except the hour in progress on today, which is live.
 */
async function computeListHourlyBreakdown(profileId, addresses, dateStr, { currentValue }) {
  const { start, end } = dayBoundsUtc(dateStr);
  const isToday = dateStr === todayUtcString();
  const currentHour = isToday ? new Date().getUTCHours() : 24;

  const [closed, valueAt] = await Promise.all([
    SimPosition.find(closedFilter(profileId, addresses, start, end), { closedAt: 1, realizedPnlUsd: 1 }).lean(),
    loadValueLookup(profileId, addresses),
  ]);
  const baseline = valueAt(dateStr);

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

  let cumulativePnlUsd = 0;
  for (const bucket of hours) {
    cumulativePnlUsd += bucket.pnlUsd;
    bucket.cumulativePnlUsd = bucket.hour > currentHour ? null : cumulativePnlUsd;
    bucket.valueEstimated = false;
    if (bucket.hour > currentHour || baseline === null) {
      bucket.valueUsd = null;
    } else if (isToday && bucket.hour === currentHour && currentValue != null) {
      bucket.valueUsd = currentValue;
    } else {
      bucket.valueUsd = baseline + cumulativePnlUsd;
      bucket.valueEstimated = true;
    }
  }
  return hours;
}

/** Aggregate over days=1/7/30, plus the daily (and, for days=1, hourly) breakdown and streaks. Response shape == computeWalletRangePnl + hourlyBreakdown. */
export async function computeListRangePnl(profileId, addresses, days, { endDate, currentValue } = {}) {
  const end = endDate ?? todayUtcString();
  const dailyBreakdown = await computeListDailyBreakdown(profileId, addresses, days, { endDate: end, currentValue });
  const hourlyBreakdown = days === 1 ? await computeListHourlyBreakdown(profileId, addresses, end, { currentValue }) : undefined;

  const firstWithStart = dailyBreakdown.find((d) => d.actualizedUsd !== null);
  const sum = (key) => dailyBreakdown.reduce((total, d) => total + (d[key] || 0), 0);
  const wins = sum("wins");
  const losses = sum("losses");
  return {
    days,
    actualizedUsd: firstWithStart ? sum("actualizedUsd") : null,
    combinedUsd: sum("combinedUsd"),
    combinedPercent: sum("combinedPercent"),
    closedTradeCount: sum("closedTradeCount"),
    wins,
    losses,
    winRatePercent: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
    dailyBreakdown,
    hourlyBreakdown,
    streaks: computeStreaks(dailyBreakdown),
  };
}

/** Headline numbers for one list on one profile - lifetime figures (cash-side only, no live prices) plus the live total value. */
export async function computeListSummary(profileId, addresses, { currentValue } = {}) {
  const profileTraders = await ProfileTrader.find({ profileId, traderAddress: { $in: addresses } }, { sim: 1 }).lean();
  const sum = (pick) => profileTraders.reduce((total, pt) => total + (pick(pt.sim || {}) || 0), 0);
  return {
    traderCount: addresses.length,
    startingUsd: sum((s) => s.startingAllocationUsd),
    balanceUsd: sum((s) => s.balanceUsd),
    currentValueUsd: currentValue ?? (await currentListValueUsd(profileId, addresses)),
    realizedPnlUsd: sum((s) => s.realizedPnlUsd),
    openPositionCount: sum((s) => s.openPositionCount),
    closedPositionCount: sum((s) => s.closedPositionCount),
  };
}

/**
 * Every trader in the list: realized P&L / trades for each of the last `days`
 * UTC days, plus their all-time totals on this profile. Same return shape as
 * computeWalletTradersDailyPnl, with `overall` per trader added.
 */
export async function computeListTradersDaily(profileId, addresses, days = 7) {
  const today = todayUtcString();
  const dates = Array.from({ length: days }, (_, i) => addDaysUtc(today, -(days - 1 - i)));
  const [recent, overall] = await Promise.all([
    SimPosition.find(closedFilter(profileId, addresses, dayBoundsUtc(dates[0]).start, dayBoundsUtc(today).end), {
      traderAddress: 1,
      closedAt: 1,
      realizedPnlUsd: 1,
    }).lean(),
    SimPosition.aggregate([
      { $match: { profileId: new mongoose.Types.ObjectId(String(profileId)), traderAddress: { $in: addresses }, status: "closed" } },
      {
        $group: {
          _id: "$traderAddress",
          pnlUsd: { $sum: { $ifNull: ["$realizedPnlUsd", 0] } },
          trades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $gt: ["$realizedPnlUsd", 0] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $lt: ["$realizedPnlUsd", 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const dailyByTrader = new Map();
  for (const p of recent) {
    const row = dailyByTrader.get(p.traderAddress) ?? dates.map((date) => ({ date, pnlUsd: 0, tradeCount: 0, wins: 0, losses: 0 }));
    dailyByTrader.set(p.traderAddress, row);
    const day = row[dates.indexOf(isoDay(p.closedAt))];
    if (!day) continue;
    const pnl = p.realizedPnlUsd || 0;
    day.pnlUsd += pnl;
    day.tradeCount += 1;
    if (pnl > 0) day.wins += 1;
    else if (pnl < 0) day.losses += 1;
  }
  const overallByTrader = new Map(overall.map((o) => [o._id, o]));
  return { dates, dailyByTrader, overallByTrader };
}

/** Every list with its headline numbers on one profile - drives the /lists page. Lifetime realized from ProfileTrader.sim, today / 7-day realized from closed positions. */
export async function listOverview(profileId) {
  const [lists, traders] = await Promise.all([
    TraderList.find({}).sort({ createdAt: 1 }).lean(),
    Trader.find({ "listIds.0": { $exists: true } }, { address: 1, listIds: 1 }).lean(),
  ]);
  const allAddresses = traders.map((t) => t.address);
  const today = todayUtcString();
  const weekStart = dayBoundsUtc(addDaysUtc(today, -6)).start;

  const [profileTraders, recent] = await Promise.all([
    ProfileTrader.find({ profileId, traderAddress: { $in: allAddresses } }, { traderAddress: 1, sim: 1 }).lean(),
    SimPosition.find(closedFilter(profileId, allAddresses, weekStart, dayBoundsUtc(today).end), {
      traderAddress: 1,
      closedAt: 1,
      realizedPnlUsd: 1,
    }).lean(),
  ]);
  const ptByAddress = new Map(profileTraders.map((pt) => [pt.traderAddress, pt.sim || {}]));
  const recentByAddress = new Map();
  for (const p of recent) {
    if (!recentByAddress.has(p.traderAddress)) recentByAddress.set(p.traderAddress, []);
    recentByAddress.get(p.traderAddress).push(p);
  }

  return lists.map((list) => {
    const members = traders.filter((t) => (t.listIds || []).some((id) => String(id) === String(list._id)));
    let realizedPnlUsd = 0;
    let openPositionCount = 0;
    let closedPositionCount = 0;
    let weekPnlUsd = 0;
    let todayPnlUsd = 0;
    let weekWins = 0;
    let weekLosses = 0;
    for (const t of members) {
      const sim = ptByAddress.get(t.address) || {};
      realizedPnlUsd += sim.realizedPnlUsd || 0;
      openPositionCount += sim.openPositionCount || 0;
      closedPositionCount += sim.closedPositionCount || 0;
      for (const p of recentByAddress.get(t.address) || []) {
        const pnl = p.realizedPnlUsd || 0;
        weekPnlUsd += pnl;
        if (isoDay(p.closedAt) === today) todayPnlUsd += pnl;
        if (pnl > 0) weekWins += 1;
        else if (pnl < 0) weekLosses += 1;
      }
    }
    return {
      _id: list._id,
      name: list.name,
      traderCount: members.length,
      realizedPnlUsd,
      todayPnlUsd,
      weekPnlUsd,
      openPositionCount,
      closedPositionCount,
      weekWinRatePercent: weekWins + weekLosses > 0 ? (weekWins / (weekWins + weekLosses)) * 100 : null,
    };
  });
}
