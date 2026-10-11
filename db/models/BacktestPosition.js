import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * The outcome for one (run, address, token): the address's first valid buy,
 * our simulated copy of it, and how it ended. Field names mirror SimPosition
 * where they mean the same thing so the live trade-history UI patterns carry
 * over.
 *
 *  closed  - exited; realizedPnl* is final
 *  open    - still held when the backtest window ended (marked at the last
 *            price; NOT counted in realized P&L)
 *  skipped - the signal was looked at but no trade was simulated
 *            (skipReason says why); kept so a resumed run doesn't redo it
 *
 * Rows are written the moment a position finishes, which is what makes
 * partial results visible while the run is still going.
 */
const BacktestPositionSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, required: true },
  address: { type: String, required: true },
  mint: { type: String, required: true },
  status: { type: String, enum: ["closed", "open", "skipped"], required: true },
  skipReason: { type: String, default: null },
  // The first-buy time (unix seconds) this signal was keyed on - used to order work and for the "simulated through" marker.
  signalTime: { type: Number, required: true },

  // The real trader's legs.
  traderBuySignature: { type: String, default: null },
  traderBuyTime: { type: Number, default: null },
  traderBuySol: { type: Number, default: null },
  traderBuyUsd: { type: Number, default: null },
  traderSellSignature: { type: String, default: null },
  traderSellTime: { type: Number, default: null },

  // Our copy.
  openedAt: { type: Date, default: null }, // fill time (trader buy + execution delay)
  buyPriceUsd: { type: Number, default: null },
  buyPriceSource: { type: String, default: null }, // "trade" | "prior_trade"
  tokenAmount: { type: Number, default: null },
  costBasisUsd: { type: Number, default: null },
  buyFeeUsd: { type: Number, default: null },

  closedAt: { type: Date, default: null }, // fill time of the exit
  closeSignalAt: { type: Date, default: null }, // when the exit was decided (fill time minus the delay)
  closeReason: {
    type: String,
    enum: ["trader_sell", "stop_loss", "take_profit", "trailing_stop", "max_hold_time", null],
    default: null,
  },
  sellPriceUsd: { type: Number, default: null },
  proceedsUsd: { type: Number, default: null },
  sellFeeUsd: { type: Number, default: null },
  realizedPnlUsd: { type: Number, default: null },
  realizedPnlPercent: { type: Number, default: null },

  // For "open": value at the end of the window.
  markPriceUsd: { type: Number, default: null },
  unrealizedPnlUsd: { type: Number, default: null },
  unrealizedPnlPercent: { type: Number, default: null },

  // Excursions while held, sampled on every pool-price change (finer than live's periodic sweep).
  maxUnrealizedPnlPercent: { type: Number, default: null },
  minUnrealizedPnlPercent: { type: Number, default: null },
  tradesScanned: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

BacktestPositionSchema.index({ runId: 1, address: 1, mint: 1 }, { unique: true });
BacktestPositionSchema.index({ runId: 1, address: 1, status: 1, closedAt: 1 });
BacktestPositionSchema.index({ runId: 1, status: 1, closedAt: 1 });

export const BacktestPosition = models.BacktestPosition || model("BacktestPosition", BacktestPositionSchema);
