import { Trader } from "../models/Trader.js";
import { resolveTraderSettings } from "../settings.js";

/**
 * First-time setup of a trader's simulated balance, using whatever
 * allocationUsd resolves to (their override, or the global default) AT
 * THIS MOMENT. This only ever runs once per trader - after that, balance
 * moves only via trade P&L or a manual adjustment (db/traderService.js
 * adjustBalance), never by allocationUsd changing again. That's deliberate:
 * changing the "starting capital" setting later shouldn't silently rewrite
 * a trader's current balance out from under you.
 */
export async function ensureTraderInitialized(trader) {
  if (trader.sim?.initialized) return trader;

  const settings = await resolveTraderSettings(trader);
  const updated = await Trader.findOneAndUpdate(
    { address: trader.address, "sim.initialized": { $ne: true } },
    {
      $set: {
        "sim.initialized": true,
        "sim.startingAllocationUsd": settings.allocationUsd,
        "sim.balanceUsd": settings.allocationUsd,
      },
    },
    { returnDocument: "after" }
  );
  // If updated is null, another concurrent call already initialized it - re-fetch.
  return updated || Trader.findOne({ address: trader.address });
}
