import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One per (wallet, UTC hour): the wallet's total value (balance + unrealized
 * value of open positions) as last read during that hour - what the hourly
 * "Day" chart on the wallet's Performance tab plots. Written by the same
 * hourly maintenance tick as WalletDailySnapshot (see
 * recordHourlyWalletSnapshots in db/simulation/walletSnapshot.js), and
 * expires on its own after 45 days since nothing reads further back than the
 * month view's daily snapshots.
 */
const WalletHourlySnapshotSchema = new Schema({
  walletId: { type: Schema.Types.ObjectId, required: true, index: true },
  hour: { type: String, required: true }, // "YYYY-MM-DDTHH", UTC
  valueUsd: { type: Number, required: true },
  recordedAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 45 },
});

WalletHourlySnapshotSchema.index({ walletId: 1, hour: 1 }, { unique: true });

export const WalletHourlySnapshot = models.WalletHourlySnapshot || model("WalletHourlySnapshot", WalletHourlySnapshotSchema);
