import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * A queued simulated buy/sell, waiting out the "execution delay" (default
 * 2s) that models real-world trade latency. Persisted (not an in-memory
 * setTimeout) so a daemon restart never loses a pending fill - a poller
 * just picks up anything with triggerAt <= now and status "pending".
 */
const PendingExecutionSchema = new Schema({
  profileId: { type: Schema.Types.ObjectId, required: true, index: true },
  traderAddress: { type: String, required: true, index: true },
  mint: { type: String, required: true },
  action: { type: String, enum: ["buy", "sell"], required: true },
  triggerAt: { type: Date, required: true, index: true },
  sourceSignature: { type: String, required: true },
  status: { type: String, enum: ["pending", "processing", "done", "skipped"], default: "pending", index: true },
  skipReason: { type: String, default: null },
  // How many times this fill was put back in the queue because no price
  // could be read (see retryWithoutPrice in the executors).
  attempts: { type: Number, default: 0 },
  // Why this sell is happening - the copied trader sold ("trader_sell"), or
  // one of our own exits (stop_loss, take_profit, ...). Every exit goes
  // through this same queue so it waits the execution delay like any trade.
  closeReason: {
    type: String,
    enum: ["trader_sell", "stop_loss", "take_profit", "trailing_stop", "max_hold_time", "blacklisted"],
    default: "trader_sell",
  },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null },
});

// DB-level backstop against ever queuing two pending buys (or two pending
// sells) for the same trader+mint at once - the application-level
// `.exists()` check in db/simulation/engine.js has a TOCTOU race window
// between two concurrent calls (e.g. two tracker processes momentarily
// running at once), so this partial unique index is what actually
// guarantees it can't happen: a second insert throws code 11000, which the
// caller treats as "already queued."
PendingExecutionSchema.index(
  { profileId: 1, traderAddress: 1, mint: 1, action: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export const PendingExecution = models.PendingExecution || model("PendingExecution", PendingExecutionSchema);
