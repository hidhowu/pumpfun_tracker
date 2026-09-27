import { getGlobalSettings } from "./models/GlobalSettings.js";

// [trader override field, global default field]
const FIELDS = [
  ["allocationUsd", "defaultAllocationUsd"],
  ["tradeSizeUsd", "defaultTradeSizeUsd"],
  ["dustBuyUsd", "defaultDustBuyUsd"],
  ["dustSellFractionPercent", "defaultDustSellFractionPercent"],
  ["stopLossPercent", "defaultStopLossPercent"],
  ["takeProfitPercent", "defaultTakeProfitPercent"],
  ["benchCapPercent", "defaultBenchCapPercent"],
  ["allowNegativeBalance", "defaultAllowNegativeBalance"],
  ["executionDelaySeconds", "defaultExecutionDelaySeconds"],
  ["feeUsd", "defaultFeeUsd"],
];

/**
 * Resolves a trader's *effective* simulation settings: their own override
 * when set (not null/undefined), otherwise the current global default.
 * `stopLossPercent` in particular is commonly null on purpose (disabled).
 */
export async function resolveTraderSettings(trader, globalSettings) {
  const g = globalSettings || (await getGlobalSettings());
  const resolved = {};
  for (const [overrideField, defaultField] of FIELDS) {
    const override = trader.settings?.[overrideField];
    resolved[overrideField] = override === null || override === undefined ? g[defaultField] : override;
  }
  return resolved;
}

export function settingsFieldNames() {
  return FIELDS.map(([overrideField]) => overrideField);
}
