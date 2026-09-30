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
});

WalletTraderSchema.index({ walletId: 1, traderAddress: 1 }, { unique: true });

export const WalletTrader = models.WalletTrader || model("WalletTrader", WalletTraderSchema);
