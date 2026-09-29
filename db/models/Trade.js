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
  // Every real trade is stored (evaluateSell's dust-vs-real-exit fraction
  // needs the trader's *complete* buy/sell history for a mint, even the
  // legs we didn't act on), but most of them are just noise once they've
  // aged out of that lookback window. purgeAt starts 48h out and is cleared
  // to null the moment this trade actually queues a simulated buy/sell
  // (db/simulation/engine.js sets it via markTradeActioned) - null is never
  // touched by the TTL monitor, so actioned trades are kept indefinitely
  // while everything else quietly expires after 48h.
  purgeAt: { type: Date, default: null },
});

// A given wallet's leg of a given signature/mint/type should only ever be
// recorded once, even if the tracker sees the same notification twice.
TradeSchema.index({ traderAddress: 1, signature: 1, mint: 1, type: 1 }, { unique: true });
TradeSchema.index({ traderAddress: 1, blockTime: -1 });
TradeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const Trade = models.Trade || model("Trade", TradeSchema);
