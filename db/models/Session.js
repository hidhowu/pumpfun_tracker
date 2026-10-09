import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One signed-in browser. The cookie carries a random 256-bit token; only its
 * SHA-256 is stored here, so a leaked copy of this collection can't be
 * replayed as a login. Deleting the row signs that browser out immediately
 * (logout, password change, `manageUsers.mjs revoke`).
 *
 * `expiresAt` is the hard lifetime and drives the TTL index; the idle
 * timeout is enforced in db/authService.js against `lastSeenAt`.
 */
const SessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  ip: { type: String, default: "" },
  userAgent: { type: String, default: "" },
});

SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = models.Session || model("Session", SessionSchema);
