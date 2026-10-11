import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Which time span of an address's history has been completely collected into
 * BacktestTx (every signature in [coverFrom, coverTo] was listed AND
 * processed). Lets a new run list only the missing ends: newer than
 * `newestSignature` (`until`) and older than `oldestSignature` (`before`).
 */
const BacktestScanSchema = new Schema({
  address: { type: String, required: true, unique: true },
  coverFrom: { type: Number, required: true }, // unix seconds
  coverTo: { type: Number, required: true },
  oldestSignature: { type: String, default: null }, // oldest signature inside the covered span
  newestSignature: { type: String, default: null }, // newest signature inside the covered span
  updatedAt: { type: Date, default: Date.now },
});

export const BacktestScan = models.BacktestScan || model("BacktestScan", BacktestScanSchema);
