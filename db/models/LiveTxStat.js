import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One attempt to put a live wallet's trade on the chain - built, signed, sent and (usually) landed. Kept for the wallet's transaction stats
 * (db/live/trading/txStats.js): how fast transactions land, how many succeed, fail or have to be retried. Only real transactions are
 * recorded here; a dry run sends nothing.
 *
 * Times are wall-clock Unix ms. `totalMs` is what the speed stats are made of: from the moment the trade started being BUILT to the moment it
 * was first seen on the chain (processed or better) - the same span the latency test script measures (extras/buyLatencyTest/buy.mjs).
 */
const LiveTxStatSchema = new Schema({
  liveWalletId: { type: Schema.Types.ObjectId, required: true },
  executionId: { type: Schema.Types.ObjectId, required: true },
  action: { type: String, enum: ["buy", "sell"], required: true },
  mint: { type: String, required: true },
  traderAddress: { type: String, default: null },
  closeReason: { type: String, default: null },
  // Which try of this trade it was: 1 = the first, 2+ = a retry.
  attempt: { type: Number, default: 1 },
  sendMode: { type: String, enum: ["raw", "jito", null], default: null },
  route: { type: String, default: null },
  signature: { type: String, default: null },
  // success   - landed and did what it should
  // reverted  - landed but the program refused it (only the network fee is lost)
  // expired   - never landed before its blockhash ran out
  // error     - never got as far as the chain (couldn't be built, no route, the RPC failed, ...)
  outcome: { type: String, enum: ["success", "reverted", "expired", "error"], required: true },
  error: { type: String, default: null },
  startedAt: { type: Date, required: true },
  sentAt: { type: Date, default: null },
  landedAt: { type: Date, default: null },
  buildMs: { type: Number, default: null }, // started -> first sent
  totalMs: { type: Number, default: null }, // started -> landed
  at: { type: Date, default: Date.now },
});

LiveTxStatSchema.index({ liveWalletId: 1, at: -1 });
LiveTxStatSchema.index({ liveWalletId: 1, outcome: 1, at: -1 });

export const LiveTxStat = models.LiveTxStat || model("LiveTxStat", LiveTxStatSchema);
