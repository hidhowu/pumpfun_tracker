import { getGlobalSettings } from "./models/GlobalSettings.js";
import { ProfileTrader } from "./models/ProfileTrader.js";

// [trader override field, global default field]
const FIELDS = [
  ["allocationUsd", "defaultAllocationUsd"],
  ["tradeSizeUsd", "defaultTradeSizeUsd"],
  ["dustBuyUsd", "defaultDustBuyUsd"],
  ["dustSellFractionPercent", "defaultDustSellFractionPercent"],
  ["stopLossPercent", "defaultStopLossPercent"],
  ["takeProfitPercent", "defaultTakeProfitPercent"],
  ["maxTradeTimeSeconds", "defaultMaxTradeTimeSeconds"],
  ["allowNegativeBalance", "defaultAllowNegativeBalance"],
  ["executionDelaySeconds", "defaultExecutionDelaySeconds"],
  ["pumpFeePercent", "defaultPumpFeePercent"],
  ["jitoFeeUsd", "defaultJitoFeeUsd"],
];

/**
 * Resolves a trader's *effective* simulation settings *within one profile*:
 * that profile's own override for this trader when set (not
 * null/undefined), otherwise that profile's global default.
 * `stopLossPercent` in particular is commonly null on purpose (disabled).
 * `trailingStops` is handled separately from FIELDS since an override there
 * is a whole-list replacement, not a scalar fallback - null (no override)
 * means "inherit the global list", while an explicit array (even []) means
 * "use exactly this list for this trader, ignore the global one".
 *
 * Pass `profileTrader`/`globalSettings` if the caller already has them
 * loaded (avoids a duplicate fetch); otherwise they're looked up here. A
 * trader with no ProfileTrader row yet (not lazily initialized in this
 * profile) simply resolves every field to that profile's global defaults.
 */
export async function resolveTraderSettings(profileId, traderAddress, { profileTrader, globalSettings } = {}) {
  const g = globalSettings || (await getGlobalSettings(profileId));
  const pt = profileTrader !== undefined ? profileTrader : await ProfileTrader.findOne({ profileId, traderAddress });

  const resolved = {};
  for (const [overrideField, defaultField] of FIELDS) {
    const override = pt?.settings?.[overrideField];
    resolved[overrideField] = override === null || override === undefined ? g[defaultField] : override;
  }
  resolved.trailingStops = pt?.settings?.trailingStops ?? g.defaultTrailingStops ?? [];
  return resolved;
}

export function settingsFieldNames() {
  return FIELDS.map(([overrideField]) => overrideField);
}
