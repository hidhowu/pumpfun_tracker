import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One per (wallet, UTC calendar day): the wallet's total value (balance +
 * unrealized value of open positions) at the moment this snapshot was
 * taken - the "start of day" baseline for the wallet's performance chart,
 * same role as db/models/DailySnapshot.js at the trader level. See
 * db/walletPnl.js.
 */
const WalletDailySnapshotSchema = new Schema({
  walletId: { type: Schema.Types.ObjectId, required: true, index: true },
  date: { type: String, required: true }, // "YYYY-MM-DD", UTC
  portfolioValueUsdAtOpen: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

WalletDailySnapshotSchema.index({ walletId: 1, date: 1 }, { unique: true });

export const WalletDailySnapshot = models.WalletDailySnapshot || model("WalletDailySnapshot", WalletDailySnapshotSchema);
