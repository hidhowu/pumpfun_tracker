import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * System-wide backtest tuning (one document, key "default"). Every
 * concurrency/rate field is nullable: null = "auto", derived from how many
 * proxies and RPC endpoints are configured right now (see
 * db/backtest/settings.js's resolveBacktestSettings) - so adding proxies or
 * RPCs speeds backtests up without touching anything here.
 */
const BacktestSettingsSchema = new Schema({
  key: { type: String, default: "default", unique: true },

  // How many addresses are processed at the same time (null = auto).
  addressParallelism: { type: Number, default: null },
  // How many transactions of ONE address are fetched/parsed at once (null = auto).
  txParallelismPerAddress: { type: Number, default: null },
  // How many of one address's positions are simulated at once (null = auto; always 1 when the profile disallows negative balance).
  positionParallelism: { type: Number, default: null },
  // Max RPC calls per second on one backtest-only RPC (null = auto).
  rpcRpsPerEndpoint: { type: Number, default: null },
  // Fraction of that rate a shared (live + backtest) RPC may be used at, so live is never starved.
  sharedRpcFraction: { type: Number, default: 0.3 },
  // Max pump.fun trade-history calls per second through ONE proxy (null = auto).
  proxyRps: { type: Number, default: null },
  // Rate used when no proxies are configured and requests go out directly.
  directRps: { type: Number, default: 0.7 },

  // pump.fun trade-history query.
  minSolAmount: { type: Number, default: 0.05 },
  program: { type: String, default: "pump" }, // "" = omit the parameter
  initialWindowSeconds: { type: Number, default: 60 },
  // Safety cap: pages of 100 trades read for a single position before it is given up on as "unresolved".
  maxPagesPerPosition: { type: Number, default: 400 },

  // Written by the worker on every tick - how the dashboard knows whether the worker process is actually running.
  workerHeartbeatAt: { type: Date, default: null },
  workerId: { type: String, default: null },
});

export const BacktestSettings = models.BacktestSettings || model("BacktestSettings", BacktestSettingsSchema);
