import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// One trailing-stop rule: once unrealized gain first reaches armPercent,
// the rule "arms"; if it later falls back to exitPercent (or below), the
// position auto-sells. Multiple rules can be configured (e.g. "arm at 25%,
// exit at -10%" and, independently, "arm at 50%, exit at 20%") - whichever
// triggers first closes the position. Each rule keeps its own Mongoose-
// assigned _id so a position can track exactly which rules have armed for
// it (db/simulation/executor.js), even if the rule list is edited later.
const TrailingStopSchema = new Schema({
  armPercent: { type: Number, required: true },
  exitPercent: { type: Number, required: true },
});

/**
 * One per Profile (was a true singleton before multi-profile support - see
 * db/models/SystemSettings.js for the couple of fields that stayed
 * system-wide instead). Holds the strategy defaults a trader in this
 * profile falls back to when it doesn't have its own ProfileTrader
 * override set - see db/settings.js.
 */
const GlobalSettingsSchema = new Schema({
  profileId: { type: Schema.Types.ObjectId, required: true, unique: true },

  defaultAllocationUsd: { type: Number, default: 100 },
  defaultTradeSizeUsd: { type: Number, default: 20 },
  defaultDustBuyUsd: { type: Number, default: 20 },
  defaultDustSellFractionPercent: { type: Number, default: 10 },
  defaultStopLossPercent: { type: Number, default: null }, // null = disabled
  defaultTakeProfitPercent: { type: Number, default: null }, // null = disabled
  // 0 = disabled/infinite hold time (the user-facing default) - distinct
  // from the per-trader override's null, which means "inherit this value".
  defaultMaxTradeTimeSeconds: { type: Number, default: 0 },
  defaultTrailingStops: { type: [TrailingStopSchema], default: [] },
  defaultAllowNegativeBalance: { type: Boolean, default: true },
  defaultExecutionDelaySeconds: { type: Number, default: 2 },
  defaultFeeUsd: { type: Number, default: 0.6 },
});

export const GlobalSettings = models.GlobalSettings || model("GlobalSettings", GlobalSettingsSchema);

export async function getGlobalSettings(profileId) {
  let settings = await GlobalSettings.findOne({ profileId });
  if (!settings) settings = await GlobalSettings.create({ profileId });
  return settings;
}
