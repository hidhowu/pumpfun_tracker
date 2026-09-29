import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One per (trader, UTC calendar day): the trader's total simulated
 * portfolio value (balance + unrealized value of open positions) at the
 * moment this snapshot was taken - used as the "start of day" baseline for
 * actualized P&L. See db/pnl.js.
 */
const DailySnapshotSchema = new Schema({
  profileId: { type: Schema.Types.ObjectId, required: true, index: true },
  traderAddress: { type: String, required: true, index: true },
  date: { type: String, required: true }, // "YYYY-MM-DD", UTC
  portfolioValueUsdAtOpen: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

DailySnapshotSchema.index({ profileId: 1, traderAddress: 1, date: 1 }, { unique: true });

export const DailySnapshot = models.DailySnapshot || model("DailySnapshot", DailySnapshotSchema);
