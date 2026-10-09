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
  createdAt: { type: Date, default: Date.now },
});

export const User = models.User || model("User", UserSchema);
