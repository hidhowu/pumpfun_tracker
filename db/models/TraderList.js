import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A user-created, named group of tracked traders (many-to-many via
 * Trader.listIds) - e.g. "Profitable", "Risky". Global, not scoped to a
 * Profile: a trader is the same trader regardless of which Profile's
 * strategy you're comparing, so how you organize/tag them is too.
 */
const TraderListSchema = new Schema({
  name: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
});

export const TraderList = models.TraderList || model("TraderList", TraderListSchema);
