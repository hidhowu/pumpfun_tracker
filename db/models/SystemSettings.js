import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * True singleton (unlike GlobalSettings, which became one-per-Profile) -
 * holds settings that are inherently system-wide, not a strategy choice:
 *
 *  - riskCheckIntervalSeconds: how often the daemon re-scans ALL open
 *    positions across EVERY profile for stop-loss/take-profit/trailing-stop/
 *    max-hold-time triggers - one sweep over everyone's positions, not
 *    something that makes sense to vary per profile.
 *  - defaultMuted: the fallback for `Trader.muted`, which is itself shared
 *    across every profile (confirmed: notification preference belongs to
 *    the wallet, not to a strategy) - so its default must be shared too.
 */
const SystemSettingsSchema = new Schema({
  key: { type: String, default: "system", unique: true },
  defaultMuted: { type: Boolean, default: false },
  riskCheckIntervalSeconds: { type: Number, default: 20 },
});

export const SystemSettings = models.SystemSettings || model("SystemSettings", SystemSettingsSchema);

export async function getSystemSettings() {
  let settings = await SystemSettings.findOne({ key: "system" });
  if (!settings) settings = await SystemSettings.create({ key: "system" });
  return settings;
}
