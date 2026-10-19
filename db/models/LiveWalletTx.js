import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One row per (transaction, token) that touched a live wallet - what the chain says happened, nothing derived. Profit/loss
 * is computed from these rows on read (db/live/pnl.js), so a late-arriving older transaction never leaves stale numbers.
 *
 * kind:
 *  - buy / sell    one token against SOL (swap, pump.fun curve or AMM)
 *  - receive / send  a token moved with no SOL on the other side (transfer, airdrop, token<->token swap leg)
 *  - burn          tokens destroyed by this wallet (like a send, with nobody on the other side and no price)
 *  - sol_in / sol_out  plain SOL transfer
 *  - other         touched the wallet without moving SOL or tokens beyond the fee (e.g. creating an account)
 *  - failed        the transaction failed on-chain; only the fee was paid
 */
const LiveWalletTxSchema = new Schema({
  walletId: { type: Schema.Types.ObjectId, ref: "LiveWallet", required: true },
  signature: { type: String, required: true },
  mint: { type: String, default: null }, // null for SOL-only / failed / other
  kind: { type: String, enum: ["buy", "sell", "receive", "send", "burn", "sol_in", "sol_out", "other", "failed"], required: true },
  slot: { type: Number, required: true },
  blockTime: { type: Date, default: null },
  tokenDelta: { type: Number, default: 0 }, // token units, + received / - sent
  // SOL moved by the trade itself, in SOL, + received / - paid. Excludes the network fee and token-account rent.
  solDelta: { type: Number, default: 0 },
  feeSol: { type: Number, default: 0 }, // network fee the wallet paid (on the first row of a transaction only)
  solUsd: { type: Number, default: null }, // SOL/USD when this row was synced - used to express SOL amounts in USD
});

LiveWalletTxSchema.index({ walletId: 1, signature: 1, mint: 1 }, { unique: true });
LiveWalletTxSchema.index({ walletId: 1, slot: -1 });

export const LiveWalletTx = models.LiveWalletTx || model("LiveWalletTx", LiveWalletTxSchema);
