import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Tiny command queue letting the Next.js web process ask the separately-
 * running tracker daemon to do something (currently: force an RPC
 * reconnect). The daemon polls for pending commands, claims one atomically
 * (findOneAndUpdate pending->processing, same pattern as PendingExecution),
 * acts on it, then marks it done/failed. Not meant to accumulate - old
 * commands are harmless clutter, so they ride the same 24h TTL as SystemLog.
 */
const SystemCommandSchema = new Schema({
  type: { type: String, enum: ["reconnect_rpc"], required: true },
  status: { type: String, enum: ["pending", "processing", "done", "failed"], default: "pending", index: true },
  // null = reconnect every RPC endpoint (legacy/global behavior); a specific
  // RpcEndpoint.url = reconnect only that one, from the per-endpoint button
  // on the /rpc page.
  targetUrl: { type: String, default: null },
  requestedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  error: { type: String, default: null },
});

SystemCommandSchema.index({ requestedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export const SystemCommand = models.SystemCommand || model("SystemCommand", SystemCommandSchema);
