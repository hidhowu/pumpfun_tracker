import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * An address on the Backtest list. Deliberately its own collection - never
 * mixed with Trader: backtest addresses aren't WebSocket-subscribed, so the
 * per-endpoint address limits don't apply to them, and adding/removing one
 * has no effect on live tracking. The same address may exist in both places.
 */
const BacktestAddressSchema = new Schema({
  address: { type: String, required: true, unique: true, index: true },
  label: { type: String, default: "" },
  notes: { type: String, default: "" },
  source: { type: String, enum: ["manual", "traders", "list", "import"], default: "manual" },
  addedAt: { type: Date, default: Date.now },
});

export const BacktestAddress = models.BacktestAddress || model("BacktestAddress", BacktestAddressSchema);
