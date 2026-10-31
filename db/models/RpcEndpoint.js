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
  // Auto-managed health, separate from the manual `enabled` switch (same idea as db/models/Proxy.js): once
  // db/rpcHealth.js's recordRpcResult sees RPC_FAILURE_THRESHOLD rate-limit failures in a row, health flips to
  // "blacklisted" and the endpoint is skipped everywhere until a test (or a real call) succeeds again.
  health: { type: String, enum: ["active", "blacklisted"], default: "active" },
  consecutiveFailures: { type: Number, default: 0 },
  lastCheckedAt: { type: Date, default: null },
  lastSuccessAt: { type: Date, default: null },
  blacklistedAt: { type: Date, default: null },
  // Result of the most recent test (UI "Test" button / "Test all").
  lastTest: {
    type: new Schema(
      {
        at: { type: Date },
        verdict: { type: String },
        latencyMs: { type: Number, default: null },
        message: { type: String, default: null },
      },
      { _id: false }
    ),
    default: null,
  },
  createdAt: { type: Date, default: Date.now },
});

export const RpcEndpoint = models.RpcEndpoint || model("RpcEndpoint", RpcEndpointSchema);
