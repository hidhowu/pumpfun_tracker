import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Singleton document (key is always "global"). Holds the defaults a
// trader falls back to when they don't have their own override set.
const GlobalSettingsSchema = new Schema({
  key: { type: String, default: "global", unique: true },
  defaultMuted: { type: Boolean, default: false },

  // Simulation defaults - see db/settings.js for how per-trader overrides
  // resolve against these.
  defaultAllocationUsd: { type: Number, default: 100 },
  defaultTradeSizeUsd: { type: Number, default: 20 },
  defaultDustBuyUsd: { type: Number, default: 20 },
  defaultDustSellFractionPercent: { type: Number, default: 10 },
  defaultStopLossPercent: { type: Number, default: null }, // null = disabled
  defaultTakeProfitPercent: { type: Number, default: null }, // null = disabled
  defaultBenchCapPercent: { type: Number, default: null }, // null = disabled
  defaultAllowNegativeBalance: { type: Boolean, default: true },
  defaultExecutionDelaySeconds: { type: Number, default: 2 },
  defaultFeeUsd: { type: Number, default: 0.6 },

  // NOT a per-trader override (unlike the default* fields above) - this is
  // how often the daemon re-scans ALL open positions for stop-loss/take-
  // profit/bench triggers. One system-wide polling cadence, not something
  // that makes sense to vary per trader since it's a single sweep over
  // everyone's positions each tick. See src/tracker.js's risk-check loop.
  riskCheckIntervalSeconds: { type: Number, default: 20 },
});

export const GlobalSettings = models.GlobalSettings || model("GlobalSettings", GlobalSettingsSchema);

export async function getGlobalSettings() {
  let settings = await GlobalSettings.findOne({ key: "global" });
  if (!settings) settings = await GlobalSettings.create({ key: "global" });
  return settings;
}
