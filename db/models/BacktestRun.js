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
