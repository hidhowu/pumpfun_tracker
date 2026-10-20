import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A trade of a tracked trader as the pump.fun API reported it (db/simulation/apiTradePoller.js) - what the "api" tracking method
 * (Wallet.settings.trackingMethod) works from, where the "logs" method works from the Trade collection. Kept apart on purpose:
 * Trade is written by the log pipeline, whose "is this new?" answer decides whether a log-tracked wallet sees a trade at all,
 * so an API reader writing the same rows would silently starve it (and the other way round).
 *
 * The one use that needs the history is the dust-sell fraction ("this sell is X% of what the trader bought"), which sums the
 * trader's earlier buys of a mint - the same arithmetic as db/simulation/engine.js's sumTraderTokenAmount, over these rows.
 */
const ApiTradeSchema = new Schema({
  traderAddress: { type: String, required: true },
  signature: { type: String, required: true },
  type: { type: String, enum: ["buy", "sell"], required: true },
  mint: { type: String, required: true },
  tokenAmount: { type: Number, default: null },
  solAmount: { type: Number, default: null },
  amountUsd: { type: Number, default: null },
  blockTime: { type: Number, default: null }, // seconds
  recordedAt: { type: Date, default: Date.now },
  // Same rule as Trade.purgeAt: 48h out, cleared once a wallet acts on the trade (a position needs its history for as long as it lives).
  purgeAt: { type: Date, default: null },
});

ApiTradeSchema.index({ traderAddress: 1, signature: 1, mint: 1, type: 1 }, { unique: true });
ApiTradeSchema.index({ traderAddress: 1, mint: 1, type: 1 });
ApiTradeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const ApiTrade = models.ApiTrade || model("ApiTrade", ApiTradeSchema);
