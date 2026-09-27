import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const TradeSchema = new Schema({
  traderAddress: { type: String, required: true, index: true },
  signature: { type: String, required: true },
  type: { type: String, enum: ["buy", "sell"], required: true },
  program: { type: String, required: true }, // "pump.fun" | "pump.fun-amm"
  mint: { type: String, required: true, index: true },
  tokenAmount: { type: Number, default: null },
  solAmount: { type: Number, default: null },
  solAmountSource: { type: String, default: null }, // "event" | "wallet_balance_delta"
  isNativeSolQuote: { type: Boolean, default: true },
  quoteMint: { type: String, default: null },
  slot: { type: Number, default: null },
  blockTime: { type: Number, default: null },
  recordedAt: { type: Date, default: Date.now },
});

// A given wallet's leg of a given signature/mint/type should only ever be
// recorded once, even if the tracker sees the same notification twice.
TradeSchema.index({ traderAddress: 1, signature: 1, mint: 1, type: 1 }, { unique: true });
TradeSchema.index({ traderAddress: 1, blockTime: -1 });

export const Trade = models.Trade || model("Trade", TradeSchema);
