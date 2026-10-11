import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A plain HTTP JSON-RPC endpoint (e.g. an Alchemy key) the tracker daemon
 * round-robins through for every non-websocket Solana RPC call
 * (getTransaction, etc - see src/rpcPool.js). Deliberately separate from
 * RpcEndpoint (db/models/RpcEndpoint.js), which is WS-only and carries live
 * connect/disconnect/status machinery this doesn't need - an HTTP call is
 * stateless, so there's nothing to track here beyond "is it in the pool
 * right now." Managed from the /rpc page's second section.
 */
const HttpRpcEndpointSchema = new Schema({
  url: { type: String, required: true, unique: true },
  label: { type: String, default: "" },
  enabled: { type: Boolean, default: true },
  // "both" = used by live tracking AND backtests (backtests throttle these so
  // live is never starved); "backtest" = ONLY ever used by backtests - for slow
  // or cheap providers that must never serve live trade detection. Documents
  // from before this field existed read as "both" (every live query below
  // uses $ne: "backtest", so no backfill is needed).
  scope: { type: String, enum: ["both", "backtest"], default: "both" },
  createdAt: { type: Date, default: Date.now },
});

export const HttpRpcEndpoint = models.HttpRpcEndpoint || model("HttpRpcEndpoint", HttpRpcEndpointSchema);
