import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const TradeSchema = new Schema(
  {
    type: { type: String, enum: ["buy", "sell"], required: true },
    program: { type: String, default: null },
    mint: { type: String, required: true },
    tokenAmount: { type: Number, default: null },
    solAmount: { type: Number, default: null },
    solAmountSource: { type: String, default: null },
    isNativeSolQuote: { type: Boolean, default: true },
  },
  { _id: false }
);

/**
 * Cache of every transaction already fetched+parsed for a backtest address -
 * one row per successful signature, whether or not it contained a pump.fun
 * trade (an empty `trades` array means "looked at it, nothing there", so it
 * is never fetched again). Shared across ALL runs: a later 30-day backtest
 * of an address that already has 12 days cached only fetches the missing
 * days. Independent of any profile/settings - those only matter when the
 * cached trades are turned into positions.
 */
const BacktestTxSchema = new Schema({
  address: { type: String, required: true },
  signature: { type: String, required: true },
  blockTime: { type: Number, required: true }, // unix seconds
  slot: { type: Number, default: null },
  // Position inside the slot (from pump.fun's slotIndexId) - orders two transactions of the same slot. Only rows read from the user-trades API have it.
  ix: { type: String, default: null },
  trades: { type: [TradeSchema], default: [] },
  // The RPC kept answering "not found" (transaction pruned/unavailable) - recorded so it isn't retried forever.
  unavailable: { type: Boolean, default: false },
});

BacktestTxSchema.index({ address: 1, signature: 1 }, { unique: true });
BacktestTxSchema.index({ address: 1, blockTime: 1 });

export const BacktestTx = models.BacktestTx || model("BacktestTx", BacktestTxSchema);
