import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * The live wallets' trade queue - the counterpart of WalletPendingExecution, with no execution delay: an entry is due the moment it is
 * made. Same crash-safety scheme (db/simulation/atomic.js): `fill` holds the frozen plan - including the SIGNED transaction, written
 * before it is sent - so a run that dies mid-trade resumes by checking that very signature on the chain instead of ever sending a second one.
 */
const LiveExecutionSchema = new Schema({
  liveWalletId: { type: Schema.Types.ObjectId, required: true, index: true },
  walletId: { type: Schema.Types.ObjectId, required: true }, // the simulation wallet it copies
  traderAddress: { type: String, required: true, index: true },
  mint: { type: String, required: true },
  action: { type: String, enum: ["buy", "sell"], required: true },
  triggerAt: { type: Date, required: true, index: true },
  sourceSignature: { type: String, required: true },
  status: { type: String, enum: ["pending", "processing", "done", "skipped"], default: "pending", index: true },
  skipReason: { type: String, default: null },
  attempts: { type: Number, default: 0 },
  closeReason: {
    type: String,
    enum: ["trader_sell", "stop_loss", "take_profit", "trailing_stop", "max_hold_time", "blacklisted"],
    default: "trader_sell",
  },
  // Dry run only: which exit mode decided this sell ("own" | "follow"); a live sell has none.
  track: { type: String, enum: ["own", "follow", null], default: null },
  leaseUntil: { type: Date, default: null },
  fill: { type: Schema.Types.Mixed, default: null },
  errorAttempts: { type: Number, default: 0 },
  reaped: { type: Number, default: 0 },
  idemKey: { type: String, default: undefined },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null },
});

LiveExecutionSchema.index({ liveWalletId: 1, traderAddress: 1, mint: 1, action: 1, track: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
LiveExecutionSchema.index({ liveWalletId: 1, idemKey: 1 }, { unique: true, partialFilterExpression: { idemKey: { $type: "string" } } });
LiveExecutionSchema.index({ status: 1, leaseUntil: 1 });

export const LiveExecution = models.LiveExecution || model("LiveExecution", LiveExecutionSchema);
