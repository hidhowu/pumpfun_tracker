import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Per-trader overrides for simulation behavior. null on any field means
// "inherit the matching default from GlobalSettings" - see db/settings.js.
const SimSettingsSchema = new Schema(
  {
    allocationUsd: { type: Number, default: null }, // only used at first-init of sim.balanceUsd - see db/settings.js
    tradeSizeUsd: { type: Number, default: null },
    dustBuyUsd: { type: Number, default: null },
    dustSellFractionPercent: { type: Number, default: null },
    stopLossPercent: { type: Number, default: null }, // null (explicit) = disabled for this trader
    takeProfitPercent: { type: Number, default: null }, // null = disabled - auto-sell once unrealized gain reaches this %
    benchCapPercent: { type: Number, default: null }, // null = disabled - arms a "back to entry" auto-sell once this % gain is reached
    allowNegativeBalance: { type: Boolean, default: null },
    executionDelaySeconds: { type: Number, default: null },
    feeUsd: { type: Number, default: null },
  },
  { _id: false }
);

const TraderSchema = new Schema({
  address: { type: String, required: true, unique: true, index: true },
  label: { type: String, default: "" },
  notes: { type: String, default: "" },
  status: { type: String, enum: ["active", "blacklisted"], default: "active", index: true },
  // null = inherit GlobalSettings.defaultMuted; true/false = explicit per-trader override.
  muted: { type: Boolean, default: null },
  addedAt: { type: Date, default: Date.now },
  blacklistedAt: { type: Date, default: null },

  // Stats about the REAL trader's own on-chain activity (not our simulation).
  stats: {
    tradeCount: { type: Number, default: 0 },
    buyCount: { type: Number, default: 0 },
    sellCount: { type: Number, default: 0 },
    totalSolVolume: { type: Number, default: 0 },
    realizedPnlSol: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    lastTradeAt: { type: Date, default: null },
  },

  settings: { type: SimSettingsSchema, default: () => ({}) },

  // Our copy-trade simulation state for this trader.
  sim: {
    initialized: { type: Boolean, default: false },
    startingAllocationUsd: { type: Number, default: 0 }, // locked in at init time, for reference
    balanceUsd: { type: Number, default: 0 },
    everBoughtMints: { type: [String], default: [] }, // permanent dup-protection - a mint here is never bought again
    negativeBalanceEventCount: { type: Number, default: 0 },
    maxNegativeBalanceUsd: { type: Number, default: 0 }, // magnitude of the deepest negative point reached
    openPositionCount: { type: Number, default: 0 },
    closedPositionCount: { type: Number, default: 0 },
    realizedPnlUsd: { type: Number, default: 0 },
    // When our sim wallet last actually acted (opened/closed a position) -
    // deliberately NOT the tracked wallet's own on-chain last-trade time,
    // since what matters here is our own simulated activity.
    lastActionAt: { type: Date, default: null },
  },
});

export const Trader = models.Trader || model("Trader", TraderSchema);
