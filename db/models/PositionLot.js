import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One open FIFO buy lot for a trader+mint. Realized PnL and "current
 * holdings" are both derived from these: a sell consumes the oldest lots
 * first (FIFO), and whatever tokenAmountRemaining is left across all lots
 * for a mint is what the trader is still currently holding.
 */
const PositionLotSchema = new Schema({
  traderAddress: { type: String, required: true, index: true },
  mint: { type: String, required: true, index: true },
  tokenAmountRemaining: { type: Number, required: true },
  solCostRemaining: { type: Number, required: true },
  openSignature: { type: String, required: true },
  openedAt: { type: Date, default: Date.now },
});

PositionLotSchema.index({ traderAddress: 1, mint: 1, openedAt: 1 });

export const PositionLot = models.PositionLot || model("PositionLot", PositionLotSchema);
