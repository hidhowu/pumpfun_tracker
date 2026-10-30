import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One side (the buy, or the sell) of a live trade, as it really happened on the chain - or, in a dry run, as the chain's own numbers
 * say it would have. Amounts are raw: lamports for SOL, the token's smallest unit for tokens (a string, because they can pass 2^53).
 */
const LegSchema = new Schema(
  {
    signature: { type: String, default: null },
    venue: { type: String, enum: ["curve", "amm"], default: null },
    at: { type: Date, default: null },
    // SOL the swap itself moved: on a buy what it cost (pump.fun's fee included), on a sell what it paid out after pump.fun's fee.
    swapLamports: { type: Number, default: 0 },
    tipLamports: { type: Number, default: 0 }, // the Jito tip
    feeLamports: { type: Number, default: 0 }, // the network's fee: base fee plus any priority fee
    // Raw mode only: the Jito tip the simulation would have paid. NOT spent (nothing was tipped), but counted in the lot's cost and proceeds so the
    // live percentages line up with the simulation's.
    assumedTipLamports: { type: Number, default: 0 },
    sendMode: { type: String, enum: ["raw", "jito", null], default: null },
    // How SOL reached the market's quote token: "direct" (SOL-quoted), "multihop", "pool" or "jupiter"; a sale that took several transactions: "chain".
    route: { type: String, default: null },
    // The deposit the chain holds for the token account this buy opened. It is NOT part of the cost: it comes back when the account is burned
    // (db/live/trading/burnEngine.js), so it stays in the wallet's balance and never shows as a loss.
    rentLamports: { type: Number, default: 0 },
    tokenRaw: { type: String, default: "0" },
    solUsd: { type: Number, default: null }, // SOL's price in dollars at that moment
    priceUsd: { type: Number, default: null }, // what one token was worth in dollars in the swap
    verified: { type: Boolean, default: false }, // read from the confirmed transaction (true) or worked out from a quote (false)
  },
  { _id: false }
);

/* A dry run's exit (dryExits.<style id>): { reason, at, priceUsd, netLamports, swapLamports, proceedsUsd, realizedPnlUsd, realizedPnlPercent } - what leaving the position would have given under that exit style. */

/**
 * What one traded token position of one copied trader is on a live wallet: the exact tokens that trade received, so when the
 * trader sells, only THIS lot is sold (never a token another trader's lot of the same mint also holds), and the real costs.
 * At most one lot per (live wallet, trader, mint), the same as a simulated position.
 */
const LiveLotSchema = new Schema({
  liveWalletId: { type: Schema.Types.ObjectId, required: true, index: true },
  walletId: { type: Schema.Types.ObjectId, required: true, index: true }, // the simulation wallet it copies
  traderAddress: { type: String, required: true },
  mint: { type: String, required: true },
  tokenProgram: { type: String, default: null },
  decimals: { type: Number, default: 6 },

  mode: { type: String, enum: ["dry", "live"], required: true },
  status: { type: String, enum: ["open", "closed"], default: "open" },
  openedAt: { type: Date, default: Date.now },
  closedAt: { type: Date, default: null },
  sourceSignature: { type: String, default: null }, // the trader's trade that started it
  // The simulation did not take this trade after the live wallet already had (e.g. the simulated balance ran out in between).
  unpaired: { type: Boolean, default: false },
  exitMode: { type: String, default: "own" }, // which exit style it follows (live mode); a dry run works every style out (db/live/trading/styles.js)
  // Live trade size / simulation trade size when the lot was bought (the wallet's trade ratio). The simulation's dollars are multiplied by it to compare like with like.
  sizeScale: { type: Number, default: 1 },

  buy: { type: LegSchema, required: true },
  tokenRaw: { type: String, required: true }, // what this lot holds
  sell: { type: LegSchema, default: null },
  closeReason: { type: String, default: null },

  // Dollars: what the lot cost (swap + tip + network fee, never the rent) and what it paid back, fixed when it closes.
  costUsd: { type: Number, default: null },
  proceedsUsd: { type: Number, default: null },
  realizedPnlUsd: { type: Number, default: null },
  realizedPnlPercent: { type: Number, default: null },

  // Set when a SELL of this open lot ran out of retries: the position is still held and needs attention (db/live/trading/alerts.js). Cleared when it closes.
  sellFailure: {
    type: new Schema({ at: Date, reason: String, closeReason: String, failures: Number }, { _id: false }),
    default: null,
  },

  // A sale of a token quoted in other tokens takes one transaction per stage when the whole chain down to SOL doesn't fit one
  // (db/live/trading/sellChain.js): each landed stage is recorded here, and what it paid out (a quote token) waits in sellCarry for the next one.
  sellStages: { type: [Schema.Types.Mixed], default: [] },
  sellCarry: { type: new Schema({ mint: String, raw: String }, { _id: false }), default: null },

  // Trackers for the live wallet's OWN exit rules (peak / lowest value, which trailing stops are armed).
  maxValueUsd: { type: Number, default: null },
  minValueUsd: { type: Number, default: null },
  armedTrailingStopIds: { type: [String], default: [] },
  // Connected to an "api_plus" simulation wallet: the last price-check moment (epoch seconds) this lot was judged at (db/simulation/apiPlus.js).
  apiPlusLastAtSec: { type: Number, default: null },

  // Dry run only: what each exit style would have done (key = style id: "own", "follow", "cd180", ... each a DryExit), so they can be compared.
  // The lot closes when the style the wallet is set to has decided; the others go on being worked out in the background until they have decided too
  // (dryDone says they all have). The styles are those the wallet had when the lot was opened.
  dryStyles: { type: [String], default: undefined },
  dryExits: { type: Schema.Types.Mixed, default: () => ({ own: null, follow: null }) },
  dryDone: { type: Boolean, default: undefined },
});

LiveLotSchema.index({ liveWalletId: 1, traderAddress: 1, mint: 1 }, { unique: true });
LiveLotSchema.index({ liveWalletId: 1, status: 1 });
LiveLotSchema.index({ liveWalletId: 1, closedAt: -1 });
LiveLotSchema.index({ walletId: 1, traderAddress: 1, mint: 1 });

export const LiveLot = models.LiveLot || model("LiveLot", LiveLotSchema);
