import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One address inside one run, with its own stage and progress counters - what
 * the per-address progress bar and "can I already see its P&L" read.
 *
 * Progress is weighted: collecting transactions is ~35%, simulating the
 * trades ~65% (see db/backtest/progress.js). `claimedBy`/`leaseUntil` is a
 * lease so a crashed worker's addresses get picked up again automatically.
 */
const BacktestRunTraderSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, required: true, index: true },
  address: { type: String, required: true },

  stage: { type: String, enum: ["pending", "collecting", "simulating", "done", "failed", "skipped"], default: "pending" },
  error: { type: String, default: null },
  // Set when the address was stopped early as a loss trader (stage "skipped", `error` says why); null for every other skip.
  stopReason: { type: String, enum: ["loss_days", "day_loss_cap", "negative_balance", "loss_at_progress", null], default: null },
  // The pump.fun user id this address was collected with (copied from the backtest list when the run was created); "" = collect over RPC.
  userId: { type: String, default: "" },

  collect: {
    done: { type: Boolean, default: false },
    source: { type: String, enum: ["api", "rpc", null], default: null }, // where the trades are being read from
    listing: { type: Boolean, default: false }, // still paging signature lists (total not known yet)
    signaturesFound: { type: Number, default: 0 }, // successful signatures inside the window
    signaturesToProcess: { type: Number, default: 0 }, // of those, not already cached from an earlier run
    signaturesProcessed: { type: Number, default: 0 },
    signaturesFailed: { type: Number, default: 0 }, // RPC errors - retried the next time this address is collected
    tradesFound: { type: Number, default: 0 }, // pump buys+sells inside the window
  },
  sim: {
    done: { type: Boolean, default: false },
    signalsTotal: { type: Number, default: 0 }, // tokens this address bought in the window
    signalsDone: { type: Number, default: 0 },
    // Everything strictly before this instant is fully simulated (positions are worked through oldest-first) - lets the UI mark which days are complete.
    simulatedThrough: { type: Date, default: null },
    skipped: {
      dust: { type: Number, default: 0 },
      noData: { type: Number, default: 0 },
      insufficientBalance: { type: Number, default: 0 },
      unresolved: { type: Number, default: 0 },
      error: { type: Number, default: 0 },
    },
  },

  claimedBy: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
});

BacktestRunTraderSchema.index({ runId: 1, address: 1 }, { unique: true });
BacktestRunTraderSchema.index({ stage: 1, leaseUntil: 1 });

export const BacktestRunTrader = models.BacktestRunTrader || model("BacktestRunTrader", BacktestRunTraderSchema);
