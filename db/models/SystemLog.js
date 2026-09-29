import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * Operational log feed for the "Logs" UI section - RPC connection health,
 * per-address tracking status, and detected/executed trade activity. This is
 * a debugging/monitoring convenience, not a source of truth (SimPosition and
 * Trade remain that), so entries are cheap to lose: a TTL index prunes
 * anything older than 24h automatically, no manual cleanup job needed.
 */
const SystemLogSchema = new Schema({
  category: { type: String, enum: ["rpc", "tracker", "trade"], required: true, index: true },
  level: { type: String, enum: ["info", "warn", "error"], default: "info" },
  message: { type: String, required: true },
  meta: { type: Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now },
});

SystemLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });
SystemLogSchema.index({ category: 1, createdAt: -1 });

export const SystemLog = models.SystemLog || model("SystemLog", SystemLogSchema);
