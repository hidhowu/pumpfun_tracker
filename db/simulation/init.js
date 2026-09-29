import { ProfileTrader } from "../models/ProfileTrader.js";
import { resolveTraderSettings } from "../settings.js";

/**
 * First-time setup of a (profile, trader) pair's simulated balance, using
 * whatever allocationUsd resolves to (that profile's override for this
 * trader, or that profile's global default) AT THIS MOMENT. This only ever
 * runs once - after that, balance moves only via trade P&L or a manual
 * adjustment (db/traderService.js adjustBalance), never by allocationUsd
 * changing again. That's deliberate: changing the "starting capital"
 * setting later shouldn't silently rewrite a trader's current balance out
 * from under you.
 *
 * The ProfileTrader row itself is created lazily here - a profile doesn't
 * need one until it actually evaluates/tracks this trader for the first
 * time, so adding a new tracked address never has to fan out a write to
 * every existing profile up front.
 */
export async function ensureTraderInitialized(profileId, traderAddress) {
  let profileTrader = await ProfileTrader.findOne({ profileId, traderAddress });
  if (profileTrader?.sim?.initialized) return profileTrader;

  const settings = await resolveTraderSettings(profileId, traderAddress);

  if (!profileTrader) {
    try {
      return await ProfileTrader.create({
        profileId,
        traderAddress,
        sim: { initialized: true, startingAllocationUsd: settings.allocationUsd, balanceUsd: settings.allocationUsd },
      });
    } catch (err) {
      // Unique index on (profileId, traderAddress) - a concurrent call
      // already created (and initialized) this row first. Fall through to
      // the update/re-fetch path below, which handles that correctly.
      if (err?.code !== 11000) throw err;
    }
  }

  const updated = await ProfileTrader.findOneAndUpdate(
    { profileId, traderAddress, "sim.initialized": { $ne: true } },
    {
      $set: {
        "sim.initialized": true,
        "sim.startingAllocationUsd": settings.allocationUsd,
        "sim.balanceUsd": settings.allocationUsd,
      },
    },
    { returnDocument: "after" }
  );
  return updated || ProfileTrader.findOne({ profileId, traderAddress });
}
