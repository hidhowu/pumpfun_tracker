import { NegativeBalanceEvent } from "./models/NegativeBalanceEvent.js";
import { todayUtcString } from "./simulation/snapshot.js";

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

/** Count + deepest point reached, for negative-balance crossings within exactly one UTC calendar day, within one profile. */
export async function getDailyNegativeBalanceStats(profileId, traderAddress, dateStr) {
  const { start, end } = dayBoundsUtc(dateStr);
  const events = await NegativeBalanceEvent.find(
    { profileId, traderAddress, occurredAt: { $gte: start, $lt: end } },
    { depthUsd: 1 }
  ).lean();

  const count = events.length;
  const maxDepthUsd = count > 0 ? Math.max(...events.map((e) => e.depthUsd)) : 0;
  return { date: dateStr, count, maxDepthUsd };
}

/** Convenience wrapper for "today" (UTC) - the number the trader detail page's quick-stats need. */
export async function getTodayNegativeBalanceStats(profileId, traderAddress) {
  return getDailyNegativeBalanceStats(profileId, traderAddress, todayUtcString());
}

/** Day-by-day breakdown for the last `days` days (inclusive of today), oldest first - same shape/period convention as db/pnl.js's computeDailyBreakdown, for the P&L breakdown UI to show alongside actualized/combined P&L. */
export async function getNegativeBalanceBreakdown(profileId, traderAddress, days) {
  const today = todayUtcString();
  const results = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = addDaysUtc(today, -i);
    results.push(await getDailyNegativeBalanceStats(profileId, traderAddress, dateStr));
  }
  return results;
}
