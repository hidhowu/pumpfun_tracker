import { SystemSettings } from "../models/SystemSettings.js";

/** Kill switch (SystemSettings.tradingPaused): when on, no new BUY fills anywhere; exits keep working. */
export async function isTradingPaused() {
  const s = await SystemSettings.findOne({ key: "system" }, { tradingPaused: 1 }).lean();
  return !!s?.tradingPaused;
}
