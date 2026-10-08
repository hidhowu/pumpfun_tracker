import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One simulated copy-trade position within a Wallet - field-for-field the
 * same shape as db/models/SimPosition.js (including the peak/lowest
 * trackers), with `walletId` in place of `profileId`. A fully separate
 * collection from SimPosition, not an optional extra field on it: this
 * simulation is independent of the Profile/Trader one in every way, and a
 * shared collection would mean a shared unique-open-position index, risking
 * the existing (already correct) Profile-scoped guarantee.
 */
const WalletPositionSchema = new Schema({
  walletId: { type: Schema.Types.ObjectId, required: true, index: true },
  traderAddress: { type: String, required: true, index: true },
  mint: { type: String, required: true },
  status: { type: String, enum: ["open", "closed"], default: "open", index: true },

  tokenAmount: { type: Number, required: true },
  costBasisUsd: { type: Number, required: true },
  buyFeeUsd: { type: Number, required: true }, // total: buyPumpFeeUsd + buyJitoFeeUsd (see db/fees.js)
  buyPumpFeeUsd: { type: Number, default: null },
  buyJitoFeeUsd: { type: Number, default: null },
  buyFeeRealizedAtOpen: { type: Boolean, default: false }, // see db/models/SimPosition.js
  buyPriceUsd: { type: Number, required: true },
  openedAt: { type: Date, default: Date.now },
  openTriggerSignature: { type: String, required: true },

  armedTrailingStopIds: { type: [String], default: [] },

  maxValueUsd: { type: Number, required: true },
  maxUnrealizedPnlUsd: { type: Number, required: true },
  maxUnrealizedPnlPercent: { type: Number, required: true },
  minValueUsd: { type: Number, default: null },
  minUnrealizedPnlUsd: { type: Number, default: null },
  minUnrealizedPnlPercent: { type: Number, default: null },

  closedAt: { type: Date, default: null },
  closeReason: {
    type: String,
    enum: ["trader_sell", "stop_loss", "take_profit", "trailing_stop", "max_hold_time", "blacklisted", null],
    default: null,
  },
  closeTriggerSignature: { type: String, default: null },
  sellPriceUsd: { type: Number, default: null },
  proceedsUsd: { type: Number, default: null },
  sellFeeUsd: { type: Number, default: null },
  sellPumpFeeUsd: { type: Number, default: null },
  sellJitoFeeUsd: { type: Number, default: null },
  realizedPnlUsd: { type: Number, default: null },
  realizedPnlPercent: { type: Number, default: null },
});

WalletPositionSchema.index({ walletId: 1, traderAddress: 1, status: 1 });
WalletPositionSchema.index({ walletId: 1, traderAddress: 1, closedAt: -1 });
WalletPositionSchema.index({ walletId: 1, closedAt: -1 });

WalletPositionSchema.index(
  { walletId: 1, traderAddress: 1, mint: 1 },
  { unique: true, partialFilterExpression: { status: "open" } }
);

export const WalletPosition = models.WalletPosition || model("WalletPosition", WalletPositionSchema);
