import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One simulated copy-trade position for a (trader, mint) pair. Doubles as
 * the "open positions" and "closed trades" data - status flips from "open"
 * to "closed" in place, nothing is deleted, so this is also the trader's
 * full simulated trade history.
 */
const SimPositionSchema = new Schema({
  traderAddress: { type: String, required: true, index: true },
  mint: { type: String, required: true },
  status: { type: String, enum: ["open", "closed"], default: "open", index: true },

  // Buy side
  tokenAmount: { type: Number, required: true },
  costBasisUsd: { type: Number, required: true }, // spend only, excludes fee
  buyFeeUsd: { type: Number, required: true },
  buyPriceUsd: { type: Number, required: true }, // per-token price used for the fill
  openedAt: { type: Date, default: Date.now },
  openTriggerSignature: { type: String, required: true }, // the real trader's buy tx that triggered this

  // Set once unrealized gain first reaches the trader's benchCapPercent -
  // arms the "back to entry" auto-sell (see db/simulation/executor.js).
  benchArmed: { type: Boolean, default: false },

  // Peak (max favorable excursion) reached at any point while open, sampled
  // on the risk-check interval - answers "it eventually closed at +40%, but
  // how high did it actually go before coming back down?" These three are
  // always derived from the SAME observed peak moment (maxValueUsd is the
  // canonical one; the $/% profit fields are just that value minus the
  // fixed cost basis, computed once and stored for convenient display).
  maxValueUsd: { type: Number, required: true }, // peak token worth (tokenAmount * price at the peak)
  maxUnrealizedPnlUsd: { type: Number, required: true },
  maxUnrealizedPnlPercent: { type: Number, required: true },

  // Sell side (set when closed)
  closedAt: { type: Date, default: null },
  closeReason: { type: String, enum: ["trader_sell", "stop_loss", "take_profit", "bench", null], default: null },
  closeTriggerSignature: { type: String, default: null },
  sellPriceUsd: { type: Number, default: null },
  proceedsUsd: { type: Number, default: null }, // gross proceeds, excludes fee
  sellFeeUsd: { type: Number, default: null },
  realizedPnlUsd: { type: Number, default: null }, // (proceeds - sellFee) - (costBasis + buyFee)
  realizedPnlPercent: { type: Number, default: null }, // realizedPnlUsd / (costBasis + buyFee) * 100
});

SimPositionSchema.index({ traderAddress: 1, status: 1 });
SimPositionSchema.index({ traderAddress: 1, closedAt: -1 });

// Ultimate DB-level backstop for "never buy the same mint twice for a
// trader": it is structurally impossible to have two *open* positions for
// the same (trader, mint) at once, regardless of any race above this layer.
// (This also serves as the general traderAddress+mint lookup index - every
// query against that key pair in this codebase filters to status:"open"
// anyway, so a separate unfiltered {traderAddress,mint} index would just be
// a duplicate key pattern - Mongoose warns about and skips those.)
SimPositionSchema.index({ traderAddress: 1, mint: 1 }, { unique: true, partialFilterExpression: { status: "open" } });

export const SimPosition = models.SimPosition || model("SimPosition", SimPositionSchema);
