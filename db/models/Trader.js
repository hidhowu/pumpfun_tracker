import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Trader identity + tracking-layer state only - shared across every
 * Profile. Simulation settings/state used to live here (`settings`/`sim`)
 * but moved to db/models/ProfileTrader.js so each Profile can run an
 * independent strategy over the same tracked wallet. Pre-existing documents
 * still physically have those old fields in MongoDB (deliberately not
 * stripped during the multi-profile migration - see
 * C:\Users\Randytech\.claude\plans\modular-floating-gosling.md) but nothing
 * reads or writes them anymore.
 */
const TraderSchema = new Schema({
  address: { type: String, required: true, unique: true, index: true },
  label: { type: String, default: "" },
  notes: { type: String, default: "" },
  status: { type: String, enum: ["active", "blacklisted"], default: "active", index: true },
  // null = inherit GlobalSettings.defaultMuted; true/false = explicit per-trader override.
  muted: { type: Boolean, default: null },
  addedAt: { type: Date, default: Date.now },
  blacklistedAt: { type: Date, default: null },

  // Which RpcEndpoint currently owns this address's live log subscription -
  // null means "needs (re)assignment", which is also the correct read for
  // any pre-existing document from before this field existed (no backfill
  // migration needed - see db/rpcAssignment.js's rebalanceAssignments).
  assignedRpcUrl: { type: String, default: null },
  subscriptionStatus: { type: String, enum: ["pending", "subscribed", "failed"], default: "pending" },

  // Which user-created TraderLists (db/models/TraderList.js) this trader has
  // been tagged into - many-to-many, purely organizational (dashboard
  // filtering), unrelated to status/blacklist.
  listIds: { type: [Schema.Types.ObjectId], default: [], index: true },

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
});

export const Trader = models.Trader || model("Trader", TraderSchema);
