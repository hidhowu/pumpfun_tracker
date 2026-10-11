import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Which time span of an address's history has been completely collected into
 * BacktestTx (every signature in [coverFrom, coverTo] was listed AND
 * processed). Lets a new run list only the missing ends: newer than
 * `newestSignature` (`until`) and older than `oldestSignature` (`before`).
 *
 * `apiCoverFrom`/`apiCoverTo` are the same idea for data read from pump.fun's
 * user-trades API (which pages by time, so no signature boundaries are needed).
 * The two are tracked apart: an address may have only one of them.
 */
const BacktestScanSchema = new Schema({
  address: { type: String, required: true, unique: true },
  coverFrom: { type: Number, default: null }, // unix seconds - RPC-collected span
  coverTo: { type: Number, default: null },
  apiCoverFrom: { type: Number, default: null }, // unix seconds - API-collected span
  apiCoverTo: { type: Number, default: null },
  oldestSignature: { type: String, default: null }, // oldest signature inside the covered span
  newestSignature: { type: String, default: null }, // newest signature inside the covered span
  updatedAt: { type: Date, default: Date.now },
});

export const BacktestScan = models.BacktestScan || model("BacktestScan", BacktestScanSchema);
