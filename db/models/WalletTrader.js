import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * The per-(Wallet, trader) join document - existence of a row IS wallet
 * membership. Mirrors db/models/ProfileTrader.js's role, but for a Wallet
 * instead of a Profile: its own permanent per-mint dedup (everBoughtMints)
 * and its own stats, scoped ONLY to trades made while this trader has been
 * assigned to this wallet (never the trader's overall/lifetime performance -
 * a trader added to a wallet starts at zero here, regardless of how it's
 * done elsewhere).
 */
const WalletTraderSchema = new Schema({
  walletId: { type: Schema.Types.ObjectId, required: true, index: true },
  traderAddress: { type: String, required: true, index: true },
  addedAt: { type: Date, default: Date.now },

  everBoughtMints: { type: [String], default: [] }, // permanent dup-protection, for THIS wallet only

  openPositionCount: { type: Number, default: 0 },
  closedPositionCount: { type: Number, default: 0 },
  realizedPnlUsd: { type: Number, default: 0 }, // this trader's cumulative contribution to the wallet's P&L
  lastActionAt: { type: Date, default: null },
  // Keys of the balance/counter changes already applied to this wallet-trader (newest 400) - what makes a re-run of a half-finished
  // fill safe: each change is applied once per key, atomically with the change itself (see db/simulation/atomic.js).
  appliedOps: { type: [String], default: [], select: false },
});

WalletTraderSchema.index({ walletId: 1, traderAddress: 1 }, { unique: true });

export const WalletTrader = models.WalletTrader || model("WalletTrader", WalletTraderSchema);
