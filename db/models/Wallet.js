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
  // Only simulation wallets/profiles can be reset, topped up, forked or deleted - see db/mode.js.
  mode: { type: String, enum: ["simulation", "live"], default: "simulation", immutable: true },
  startingBalanceUsd: { type: Number, required: true },
  balanceUsd: { type: Number, required: true }, // current available balance, always >= 0
  realizedPnlUsd: { type: Number, default: 0 }, // lifetime cumulative, across every trader ever assigned
  openPositionCount: { type: Number, default: 0 },
  closedPositionCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  // Keys of the balance/counter changes already applied to this wallet (newest 400) - what makes a re-run of a half-finished
  // fill safe: each change is applied once per key, atomically with the change itself (see db/simulation/atomic.js).
  appliedOps: { type: [String], default: [], select: false },

  // UTC date string ("YYYY-MM-DD", see db/simulation/snapshot.js's
  // todayUtcString) of the last automatic daily balance reset applied to
  // this wallet - null if never. Guards against re-applying the reset on
  // every hourly check within the same day (see
  // db/simulation/walletSnapshot.js's applyDailyBalanceResets).
  lastAutoResetDate: { type: String, default: null },
  lastAutoResetAt: { type: Date, default: null }, // exact time of the last automatic reset - shown in wallet settings

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
    // Fees on every buy AND sell - see db/fees.js. Replaces the old flat feeUsd.
    pumpFeePercent: { type: Number, default: 1.25 },
    jitoFeeUsd: { type: Number, default: 0 },
    // When true, balanceUsd is force-reset to startingBalanceUsd once per
    // UTC day (see applyDailyBalanceResets) - open positions, trade history,
    // and realizedPnlUsd are completely untouched, so day-over-day
    // performance tracking keeps working; this is deliberately for "test
    // this strategy with a fresh $X every day" rather than strict capital
    // accounting.
    autoResetBalanceDaily: { type: Boolean, default: false },
    // How this wallet learns about its traders' trades:
    //  - "logs": the tracker's RPC log subscription (the original way) - pump.fun's price/fees are modelled by db/pumpFunApi.js's
    //    getPrice and the pump-fee setting above;
    //  - "api": the tracker polls pump.fun's user-trades API for this wallet's traders (db/simulation/apiTradePoller.js), checks the
    //    token has trades before buying, and prices every fill and every stop-loss / take-profit check with pump.fun's SDK
    //    (db/simulation/sdkQuote.js) - the SDK's quote already contains pump.fun's fee, so pumpFeePercent is not charged again.
    // Per wallet: a trader in two wallets is followed both ways, each wallet by its own method.
    trackingMethod: { type: String, enum: ["logs", "api"], default: "logs" },
    // Panic level: how deep a loss stretch (in dollars, a positive number) this wallet may reach before it counts as doing worse than
    // expected - normally a bit beyond the "deepest point" its backtest showed. null = off. Display only (db/walletPanic.js): it
    // never stops or changes a trade.
    panicLossUsd: { type: Number, default: null },
  },
});

export const Wallet = models.Wallet || model("Wallet", WalletSchema);
