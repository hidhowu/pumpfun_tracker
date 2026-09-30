import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Wallet-scoped mirror of db/models/PendingExecution.js - `walletId` in
 * place of `profileId`, same partial-unique-index concurrency guarantee. A
 * fully separate collection (not an optional walletId on PendingExecution)
 * for the same reason as WalletPosition - zero shared index/query surface
 * with the existing Profile-scoped queue.
 */
const WalletPendingExecutionSchema = new Schema({
  walletId: { type: Schema.Types.ObjectId, required: true, index: true },
  traderAddress: { type: String, required: true, index: true },
  mint: { type: String, required: true },
  action: { type: String, enum: ["buy", "sell"], required: true },
  triggerAt: { type: Date, required: true, index: true },
  sourceSignature: { type: String, required: true },
  status: { type: String, enum: ["pending", "processing", "done", "skipped"], default: "pending", index: true },
  skipReason: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null },
});

WalletPendingExecutionSchema.index(
  { walletId: 1, traderAddress: 1, mint: 1, action: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export const WalletPendingExecution = models.WalletPendingExecution || model("WalletPendingExecution", WalletPendingExecutionSchema);
