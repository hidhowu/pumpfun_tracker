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
  // A third kind: a cool-down style, "cd<seconds>", one of cooldownStyles below (db/live/trading/styles.js).
  exitMode: { type: String, default: "own" },
  // Cool-down exit styles, worked out side by side with "own" and "follow" in a dry run. Within `seconds` of the buy a position is only sold by a stop-loss of
  // `stopLossPercent` (50 = -50%), a take-profit, the max hold time, or a trailing stop that is in profit; after that the profile's own rules apply.
  cooldownStyles: { type: [new Schema({ seconds: { type: Number, required: true }, stopLossPercent: { type: Number, default: 50 } }, { _id: false })], default: [] },
  // How far the price may move against a trade between quote and fill before the program refuses it (percent).
  buySlippagePercent: { type: Number, default: 15 },
  sellSlippagePercent: { type: Number, default: 25 },
  // How transactions reach the chain (db/live/trading/liveTx.js):
  //   "jito" - a one-transaction Jito bundle with a tip (a refused trade never lands, so it costs nothing);
  //   "raw"  - a plain Solana transaction through the RPC with a small priority fee (cheaper; a refused trade still pays its network fee).
  // Documents made before this setting existed have no value: read them through db/live/trading/settings.js, which supplies the defaults.
  sendMode: { type: String, enum: ["raw", "jito"], default: "jito" },
  // The wallet's own Jito fee per transaction in dollars, used exactly as entered: the real tip in Jito mode, the assumed (unspent) fee in raw mode.
  // null = the connected simulation wallet's Jito fee.
  jitoTipUsd: { type: Number, default: null },
  // Raw mode, no own Jito fee: scale the simulation's fee down with a smaller trade size (never above the simulation's fee). Off = the full fee at any size.
  scaleJitoFee: { type: Boolean, default: true },
  // Raw mode: priority fee in micro-lamports per compute unit (1000 on a 300,000-unit limit is 300 lamports, about $0.00005).
  rawPriorityMicroLamports: { type: Number, default: 1000 },
  // Trade size relative to the simulation wallet: the live wallet spends  simulation trade size x tradeRatioLive / tradeRatioSim.
  // 1 : 1 = the same dollars, 10 : 1 = a tenth of them.
  tradeRatioSim: { type: Number, default: 1 },
  tradeRatioLive: { type: Number, default: 1 },
  // Seconds the wallet waits, after the simulation decides to buy or sell, before it prices and builds the trade (dry or live). 0 = at once.
  // The simulation waits its own execution delay; setting the same here makes both fill at the same moment.
  tradeDelaySeconds: { type: Number, default: 0 },
  // New buys are switched off (dry or live). Positions already open are still sold when they exit.
  paused: { type: Boolean, default: false },
  // "Reset dry run": the dry-run comparison and the day-by-day exit-style results count only the dry trades opened after this moment (nothing is deleted).
  dryResetAt: { type: Date, default: null },
  // The wallet's address lookup table (db/live/trading/lookupTable.js): makes the bigger swaps (paying with SOL, token-quoted markets) fit one transaction.
  lookupTable: { type: String, default: null },
  connectedAt: { type: Date, default: null },
  // The empty-token-account burn engine (db/live/trading/burnEngine.js) last visited this wallet.
  lastBurnSweepAt: { type: Date, default: null },
});

// One simulation wallet can feed at most one live wallet.
LiveWalletSchema.index({ connectedWalletId: 1 }, { unique: true, partialFilterExpression: { connectedWalletId: { $type: "objectId" } } });

export const LiveWallet = models.LiveWallet || model("LiveWallet", LiveWalletSchema);
