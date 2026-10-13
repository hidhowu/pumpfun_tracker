import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One backtest: a fixed time window, a frozen copy of the chosen profile's
 * settings, and a set of addresses. Per-address progress lives in
 * BacktestRunTrader, results in BacktestPosition - this document is just the
 * definition and the run-level control/status.
 *
 * `control` is how the web app talks to the worker (separate processes, Mongo
 * is the channel): the worker polls it between steps and acts on it.
 */
const BacktestRunSchema = new Schema({
  name: { type: String, required: true },
  days: { type: Number, required: true },
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },

  profileId: { type: Schema.Types.ObjectId, default: null },
  profileName: { type: String, default: "" },
  // Frozen at creation so later edits to the profile never change a finished
  // (or running) backtest. See db/backtest/service.js's snapshotProfileSettings.
  settings: { type: Schema.Types.Mixed, required: true },

  addresses: { type: [String], default: [] },
  // "separate": every address is judged on its own wallet. "combined": all addresses trade as ONE wallet with a shared starting balance
  // (see db/backtest/combined.js) - the trades are still simulated per address, the shared balance is worked out from them in time order.
  mode: { type: String, enum: ["separate", "combined"], default: "separate" },
  combined: {
    type: new Schema(
      {
        startingBalanceUsd: { type: Number, required: true },
        // Every UTC day starts again from the starting balance (a trade belongs to the day it was entered).
        resetDaily: { type: Boolean, default: false },
        // false = a buy the balance can't pay is not taken instead of pushing the balance below zero.
        allowNegativeBalance: { type: Boolean, default: true },
      },
      { _id: false }
    ),
    default: null,
  },
  // An address with more signatures than this inside the window is skipped instead of collected (0 / missing = no limit).
  maxSignatures: { type: Number, default: 0 },
  // Early stop (see db/backtest/earlyStop.js): a trader that is clearly losing is dropped instead of worked to the end. Each rule is off at 0.
  earlyStop: {
    lossDays: { type: Number, default: 0 }, // stop after this many full days that closed in a loss
    dayLossPercent: { type: Number, default: 0 }, // stop when one full day closed at or below minus this percent
    negativeBalanceEvents: { type: Number, default: 0 }, // stop after this many buys that left the simulated wallet below zero
    lossAtProgressPercent: { type: Number, default: 0 }, // stop once this percent of the tokens are processed and the P&L is still negative
  },
  // How many addresses of THIS run are worked on at once (null = the worker's automatic number, see Backtest settings).
  addressParallelism: { type: Number, default: null },
  // How many UTC days of ONE address are worked on at once (see positionScheduler.js). 0 = no limit: positions are handed out in order as fast as slots free up.
  // 1 = a day is finished before the next one starts (what the loss-trader rules like best). Runs made before this existed have none, which reads as 0.
  daysAtOnce: { type: Number, default: 0 },

  status: { type: String, enum: ["queued", "running", "paused", "completed", "cancelled", "failed"], default: "queued", index: true },
  control: { type: String, enum: ["run", "pause", "cancel"], default: "run" },
  error: { type: String, default: null },

  createdAt: { type: Date, default: Date.now },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  // Time actually spent working, excluding paused/stopped periods - what the ETA is based on.
  activeMs: { type: Number, default: 0 },
});

export const BacktestRun = models.BacktestRun || model("BacktestRun", BacktestRunSchema);
