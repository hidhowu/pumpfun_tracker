import { Trader } from "../models/Trader.js";
import { Profile } from "../models/Profile.js";
import { ProfileTrader } from "../models/ProfileTrader.js";
import { SimPosition } from "../models/SimPosition.js";
import { DailySnapshot } from "../models/DailySnapshot.js";
import { getCoinInfo, priceFromCoinInfo } from "../pumpFunApi.js";

export function todayUtcString(date = new Date()) {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** balance + unrealized value of every currently-open position, within one profile, right now. */
export async function currentPortfolioValueUsd(profileId, traderAddress) {
  const profileTrader = await ProfileTrader.findOne({ profileId, traderAddress });
  if (!profileTrader) return 0;

  const openPositions = await SimPosition.find({ profileId, traderAddress, status: "open" });
  let unrealized = 0;
  for (const position of openPositions) {
    const coin = await getCoinInfo(position.mint).catch(() => null);
    const price = priceFromCoinInfo(coin);
    unrealized += price?.priceUsd ? position.tokenAmount * price.priceUsd : position.costBasisUsd; // fall back to cost basis if price is unavailable
  }
  return profileTrader.sim.balanceUsd + unrealized;
}

/**
 * Makes sure today's (UTC) baseline snapshot exists for a (profile, trader)
 * pair, creating it from the CURRENT portfolio value if missing. This is
 * what "start of day" means for actualized P&L (db/pnl.js). Self-healing by
 * design: if the daemon was down at midnight, the first read of the day
 * just seeds today's baseline from whatever the value is right then (a
 * reasonable approximation) rather than requiring a perfectly-timed cron.
 */
export async function ensureTodaySnapshot(profileId, traderAddress, date = todayUtcString()) {
  const existing = await DailySnapshot.findOne({ profileId, traderAddress, date });
  if (existing) return existing;

  const value = await currentPortfolioValueUsd(profileId, traderAddress);
  try {
    return await DailySnapshot.create({ profileId, traderAddress, date, portfolioValueUsdAtOpen: value });
  } catch (err) {
    if (err?.code === 11000) return DailySnapshot.findOne({ profileId, traderAddress, date }); // race - someone else just created it
    throw err;
  }
}

/**
 * Runs ensureTodaySnapshot for every (profile, active trader) combination.
 * Call once on daemon startup and roughly hourly (cheap no-op once today's
 * snapshot already exists for a pair).
 */
export async function ensureTodaySnapshotsForAllActiveTraders() {
  const [profiles, traders] = await Promise.all([
    Profile.find({}, { _id: 1 }).lean(),
    Trader.find({ status: "active" }, { address: 1 }).lean(),
  ]);
  for (const profile of profiles) {
    for (const trader of traders) {
      await ensureTodaySnapshot(profile._id, trader.address);
    }
  }
  return profiles.length * traders.length;
}
