import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A "combined view" of a finished backtest: the stored trades of some (or all) of its addresses, re-priced with its OWN trade amount and fees and
 * added up on ONE shared balance - exactly like a combined backtest, but without running anything again. It holds only the definition; the results
 * are worked out from the source run's BacktestPosition rows every time it is opened (see db/backtest/views.js), so it always follows the run.
 */
const BacktestViewSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true },
  // Empty = every address of the run (also the ones added to the run later). Otherwise only these, which must all be addresses of the run.
  addresses: { type: [String], default: [] },

  startingBalanceUsd: { type: Number, required: true },
  tradeSizeUsd: { type: Number, required: true },
  pumpFeePercent: { type: Number, required: true },
  jitoFeeUsd: { type: Number, required: true },
  resetDaily: { type: Boolean, default: false },
  allowNegativeBalance: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now },
});

BacktestViewSchema.index({ runId: 1, createdAt: 1 });

export const BacktestView = models.BacktestView || model("BacktestView", BacktestViewSchema);
