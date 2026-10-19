import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A real on-chain Solana wallet this app generated. Separate from db/models/Wallet.js (the copy-trade SIMULATION wallets)
 * on purpose: nothing that iterates simulation wallets can ever pick one of these up.
 *
 * The private key is stored only as `encryptedSecret` (AES-256-GCM, see db/live/walletKeys.js), is excluded from every
 * query by default (`select: false`). It leaves the server only through db/live/service.js: createLiveWallet (at creation)
 * and revealLiveWalletKey (needs a fresh two-factor code) - both hand it over encrypted for the asking browser.
 */
const LiveWalletSchema = new Schema({
  name: { type: String, required: true },
  address: { type: String, required: true, unique: true, immutable: true },
  encryptedSecret: { type: String, required: true, select: false, immutable: true },
  createdAt: { type: Date, default: Date.now },

  // Transaction sync (db/live/txSync.js): newest signature already stored, so the next sync only fetches what is newer.
  lastSignature: { type: String, default: null },
  lastSyncedAt: { type: Date, default: null },
  lastSyncError: { type: String, default: null },
});

export const LiveWallet = models.LiveWallet || model("LiveWallet", LiveWalletSchema);
