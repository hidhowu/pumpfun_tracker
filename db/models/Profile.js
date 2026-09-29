import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * An independent copy-trading strategy "universe" - its own settings, its
 * own simulated positions/balance per trader, but sharing the same tracked
 * wallets, RPC layer, and price lookups as every other profile (see
 * db/models/ProfileTrader.js and the plan in
 * C:\Users\Randytech\.claude\plans\modular-floating-gosling.md for the full
 * "what's shared vs what's per-profile" breakdown).
 *
 * `isDefault` marks the profile that pre-existing data was migrated into -
 * exactly one should ever have this set. It's mainly used by the UI/API to
 * pick a sane initial selection and to block deleting the last profile down
 * to zero.
 */
const ProfileSchema = new Schema({
  name: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export const Profile = models.Profile || model("Profile", ProfileSchema);
