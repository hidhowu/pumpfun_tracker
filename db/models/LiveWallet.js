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
  // Which version of db/live/txParse.js produced the stored rows; older rows are re-read once (see txSync.js).
  parserVersion: { type: Number, default: 0 },

  // ---- Copy-trading link (db/live/trading/*). A live wallet may be connected to ONE simulation wallet (db/models/Wallet.js): it then
  // takes the same trades with the same trade size, fees and exit rules, but without the simulated execution delay.
  connectedWalletId: { type: Schema.Types.ObjectId, default: null },
  // "dry": every trade is built and priced against the real chain but NOT sent (nothing is spent). "live": real transactions.
  tradingMode: { type: String, enum: ["dry", "live"], default: "dry" },
  // Which entry the stop-loss / take-profit / trailing / max-hold rules judge a live position by:
  //   "own"    - the live position's own entry (what it really paid);
  //   "follow" - the simulated position's exits are copied (the simulation decides, the live wallet follows at once).
  // A dry run works both out side by side so the two can be compared.
  exitMode: { type: String, enum: ["own", "follow"], default: "own" },
  // How far the price may move against a trade between quote and fill before the program refuses it (percent).
  buySlippagePercent: { type: Number, default: 25 },
  sellSlippagePercent: { type: Number, default: 25 },
  connectedAt: { type: Date, default: null },
  // The empty-token-account burn engine (db/live/trading/burnEngine.js) last visited this wallet.
  lastBurnSweepAt: { type: Date, default: null },
});

// One simulation wallet can feed at most one live wallet.
LiveWalletSchema.index({ connectedWalletId: 1 }, { unique: true, partialFilterExpression: { connectedWalletId: { $type: "objectId" } } });

export const LiveWallet = models.LiveWallet || model("LiveWallet", LiveWalletSchema);
