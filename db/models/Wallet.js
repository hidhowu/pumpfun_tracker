import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Same shape as db/models/GlobalSettings.js's TrailingStopSchema, including
// why _id is an explicit String rather than Mongoose's default ObjectId.
const TrailingStopSchema = new Schema({
  _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
  armPercent: { type: Number, required: true },
  exitPercent: { type: Number, required: true },
});

/**
 * A Wallet is a SECOND, fully independent copy-trade simulation - not
 * scoped to any Profile. You assign a subset of tracked traders to it
 * (WalletTrader) and give it a fixed starting balance; every real buy/sell
 * from an assigned trader is independently mirrored against THIS wallet's
 * own balance using THIS wallet's own settings below (never a Profile's or
 * a trader's individual $ allocation).
 *
 * Unlike a trader's per-Profile sim balance, a wallet's balance can NEVER
 * go negative - there is deliberately no `allowNegativeBalance` setting
 * here. If a trade would exceed what's currently available, it's simply
 * skipped for this wallet (see db/simulation/walletExecutor.js's atomic
 * balance-cap check) - the assigned trader's own per-Profile simulation is
 * completely unaffected either way.
 */
const WalletSchema = new Schema({
  name: { type: String, required: true },
  startingBalanceUsd: { type: Number, required: true },
  balanceUsd: { type: Number, required: true }, // current available balance, always >= 0
  realizedPnlUsd: { type: Number, default: 0 }, // lifetime cumulative, across every trader ever assigned
  openPositionCount: { type: Number, default: 0 },
  closedPositionCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },

  // Flat - one settings object for the whole wallet, no per-trader-within-
  // wallet override tier (unlike Profile/ProfileTrader's two-tier system).
  // Same field list/defaults as GlobalSettings' defaults, minus
  // allocationUsd (replaced by startingBalanceUsd above) and
  // allowNegativeBalance (wallets can never go negative, not configurable).
  settings: {
    tradeSizeUsd: { type: Number, default: 20 },
    dustBuyUsd: { type: Number, default: 20 },
    dustSellFractionPercent: { type: Number, default: 10 },
    stopLossPercent: { type: Number, default: null }, // null = disabled
    takeProfitPercent: { type: Number, default: null }, // null = disabled
    maxTradeTimeSeconds: { type: Number, default: 0 }, // 0 = disabled/infinite
    trailingStops: { type: [TrailingStopSchema], default: [] },
    executionDelaySeconds: { type: Number, default: 2 },
    feeUsd: { type: Number, default: 0.6 },
  },
});

export const Wallet = models.Wallet || model("Wallet", WalletSchema);
