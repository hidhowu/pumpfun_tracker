import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// See db/models/GlobalSettings.js for the field this mirrors.
const TrailingStopSchema = new Schema({
  armPercent: { type: Number, required: true },
  exitPercent: { type: Number, required: true },
});

// Per-trader overrides for simulation behavior, scoped to one Profile. null
// on any field means "inherit the matching default from that profile's
// GlobalSettings" - see db/settings.js.
const SimSettingsSchema = new Schema(
  {
    allocationUsd: { type: Number, default: null }, // only used at first-init of sim.balanceUsd - see db/settings.js
    tradeSizeUsd: { type: Number, default: null },
    dustBuyUsd: { type: Number, default: null },
    dustSellFractionPercent: { type: Number, default: null },
    stopLossPercent: { type: Number, default: null }, // null (explicit) = disabled for this trader
    takeProfitPercent: { type: Number, default: null }, // null = disabled - auto-sell once unrealized gain reaches this %
    // null = inherit the global value (0 = disabled/infinite there too).
    maxTradeTimeSeconds: { type: Number, default: null },
    // null = inherit the global list; an explicit array (including []) overrides it entirely for this trader.
    trailingStops: { type: [TrailingStopSchema], default: null },
    allowNegativeBalance: { type: Boolean, default: null },
    executionDelaySeconds: { type: Number, default: null },
    feeUsd: { type: Number, default: null },
  },
  { _id: false }
);

/**
 * The per-(Profile, trader) join document - this is what used to live as
 * `Trader.settings`/`Trader.sim` before multi-profile support. Every
 * profile gets its own independent copy of both: its own settings
 * overrides for this trader, and its own simulated wallet state (balance,
 * permanent per-mint dedup, position counts...). Created lazily the first
 * time a profile evaluates or tracks this trader (see
 * db/simulation/init.js's ensureTraderInitialized) - adding a new tracked
 * address doesn't need to fan out a write to every existing profile.
 */
const ProfileTraderSchema = new Schema({
  profileId: { type: Schema.Types.ObjectId, required: true, index: true },
  traderAddress: { type: String, required: true, index: true },

  settings: { type: SimSettingsSchema, default: () => ({}) },

  sim: {
    initialized: { type: Boolean, default: false },
    startingAllocationUsd: { type: Number, default: 0 }, // locked in at init time, for reference
    balanceUsd: { type: Number, default: 0 },
    everBoughtMints: { type: [String], default: [] }, // permanent dup-protection - a mint here is never bought again, for THIS profile
    negativeBalanceEventCount: { type: Number, default: 0 },
    maxNegativeBalanceUsd: { type: Number, default: 0 }, // magnitude of the deepest negative point reached
    openPositionCount: { type: Number, default: 0 },
    closedPositionCount: { type: Number, default: 0 },
    realizedPnlUsd: { type: Number, default: 0 },
    // When this profile's sim wallet last actually acted (opened/closed a
    // position) - deliberately NOT the tracked wallet's own on-chain
    // last-trade time, since what matters here is our own simulated activity.
    lastActionAt: { type: Date, default: null },
  },
});

ProfileTraderSchema.index({ profileId: 1, traderAddress: 1 }, { unique: true });

export const ProfileTrader = models.ProfileTrader || model("ProfileTrader", ProfileTraderSchema);
