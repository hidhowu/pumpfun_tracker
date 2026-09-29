import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A WebSocket RPC endpoint the tracker daemon subscribes addresses on.
 * Managed from the /rpc UI - going forward, adding/removing endpoints
 * happens there, not in .env (see the one-time seed in
 * db/rpcAssignment.js's ensureRpcEndpointsSeeded, which only runs when this
 * collection is empty).
 *
 * status/lastConnectedAt/lastDisconnectedAt/lastError are written by the
 * tracker daemon (a separate Node process from this web app) on every
 * connect/disconnect/error - this document is how the UI sees live
 * connection health without a direct channel to that process, same pattern
 * as SystemCommand for manual reconnect.
 */
const RpcEndpointSchema = new Schema({
  url: { type: String, required: true, unique: true },
  label: { type: String, default: "" },
  enabled: { type: Boolean, default: true },
  status: { type: String, enum: ["connected", "disconnected", "connecting"], default: "disconnected" },
  lastConnectedAt: { type: Date, default: null },
  lastDisconnectedAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  lastErrorAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

export const RpcEndpoint = models.RpcEndpoint || model("RpcEndpoint", RpcEndpointSchema);
