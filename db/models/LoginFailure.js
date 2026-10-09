import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One failed login, keyed by "user:<name>" and "ip:<addr>" - a sliding-window
 * log for brute-force throttling (db/authService.js). Keyed by the submitted
 * username whether or not that account exists, so a lockout response never
 * reveals which usernames are real. Rows age out via TTL.
 */
const LoginFailureSchema = new Schema({
  key: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

LoginFailureSchema.index({ key: 1, createdAt: -1 });
LoginFailureSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 });

export const LoginFailure = models.LoginFailure || model("LoginFailure", LoginFailureSchema);
