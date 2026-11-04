import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A tracked trader's BUY that no wallet could copy because it had no USD value: the feed could not price it (the gRPC server tries the route's own
 * balance changes, then a stored tokenized-stock price - see the grpc-server's src/netflow.js and lib/stockprice.js - and only then gives up).
 * Kept for review ("which quote tokens can't we price yet?"): pruned after 7 days (SystemLog after two), see db/simulation/unpricedLog.js.
 */
const UnpricedTradeSchema = new Schema({
  traderAddress: { type: String, required: true },
  signature: { type: String, required: true },
  mint: { type: String, required: true },
  type: { type: String, enum: ["buy", "sell"], default: "buy" },
  blockTime: { type: Number, default: null }, // seconds
  tokenAmount: { type: Number, default: null },
  quoteMint: { type: String, default: null }, // what the (collapsed) route paid with, as the feed reported it: the token to find a price for
  hops: { type: Number, default: null },
  venue: { type: String, default: null },
  trackingMethod: { type: String, default: null },
  reason: { type: String, default: "no USD value" },
  walletIds: [{ type: Schema.Types.ObjectId }], // the wallets that skipped it
  firstSeenAt: { type: Date, default: Date.now },
  purgeAt: { type: Date, default: null },
});

UnpricedTradeSchema.index({ signature: 1, traderAddress: 1, mint: 1, type: 1 }, { unique: true });
UnpricedTradeSchema.index({ quoteMint: 1, firstSeenAt: -1 });
UnpricedTradeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const UnpricedTrade = models.UnpricedTrade || model("UnpricedTrade", UnpricedTradeSchema);
