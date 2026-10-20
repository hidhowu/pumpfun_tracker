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
    feeLamports: { type: Number, default: 0 }, // the network's base fee
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

/** What leaving a dry-run position would have given, under one exit mode. */
const DryExitSchema = new Schema(
  {
    reason: { type: String, default: null },
    at: { type: Date, default: null },
    priceUsd: { type: Number, default: null },
    netLamports: { type: Number, default: 0 },
    proceedsUsd: { type: Number, default: null },
    realizedPnlUsd: { type: Number, default: null },
    realizedPnlPercent: { type: Number, default: null },
  },
  { _id: false }
);

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
  exitMode: { type: String, enum: ["own", "follow"], default: "own" }, // which exit rules it follows (live mode); a dry run follows both

  buy: { type: LegSchema, required: true },
  tokenRaw: { type: String, required: true }, // what this lot holds
  sell: { type: LegSchema, default: null },
  closeReason: { type: String, default: null },

  // Dollars: what the lot cost (swap + tip + network fee, never the rent) and what it paid back, fixed when it closes.
  costUsd: { type: Number, default: null },
  proceedsUsd: { type: Number, default: null },
  realizedPnlUsd: { type: Number, default: null },
  realizedPnlPercent: { type: Number, default: null },

  // Trackers for the live wallet's OWN exit rules (peak / lowest value, which trailing stops are armed).
  maxValueUsd: { type: Number, default: null },
  minValueUsd: { type: Number, default: null },
  armedTrailingStopIds: { type: [String], default: [] },

  // Dry run only: what each exit mode would have done, so the two can be compared. The lot closes when both have decided.
  dryExits: {
    own: { type: DryExitSchema, default: null },
    follow: { type: DryExitSchema, default: null },
  },
});

LiveLotSchema.index({ liveWalletId: 1, traderAddress: 1, mint: 1 }, { unique: true });
LiveLotSchema.index({ liveWalletId: 1, status: 1 });
LiveLotSchema.index({ liveWalletId: 1, closedAt: -1 });
LiveLotSchema.index({ walletId: 1, traderAddress: 1, mint: 1 });

export const LiveLot = models.LiveLot || model("LiveLot", LiveLotSchema);
