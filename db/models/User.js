import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A dashboard login. There is deliberately no sign-up endpoint - accounts
 * are created/managed only from the server's shell (extras/manageUsers.mjs),
 * so reaching the web app never lets anyone mint themselves an account.
 * `passwordHash` is scrypt (db/auth/password.js) and is never sent to the
 * client - select it explicitly when verifying.
 */
const UserSchema = new Schema({
  // Stored lowercased so "Admin" and "admin" can't be two accounts.
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  passwordChangedAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: null },
  // Two-factor sign-in (authenticator app, TOTP). The secret is AES-GCM encrypted (db/auth/totp.js) and, like the recovery
  // code hashes, never selected unless asked for. "pending" is a secret shown during setup that isn't active until the
  // user proves their app produces valid codes.
  totp: {
    enabled: { type: Boolean, default: false },
    enabledAt: { type: Date, default: null },
    secretEnc: { type: String, default: null, select: false },
    pendingSecretEnc: { type: String, default: null, select: false },
    // Newest time step already accepted: a code from that step or earlier is refused, so a code can't be replayed.
    lastUsedStep: { type: Number, default: null },
    recoveryHashes: { type: [String], default: [], select: false },
  },
  createdAt: { type: Date, default: Date.now },
});

export const User = models.User || model("User", UserSchema);
