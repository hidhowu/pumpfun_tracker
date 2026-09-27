import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One record per moment a trader's simulated balance crossed/landed below
 * zero (logged from db/simulation/executor.js's applyBalanceDelta, in
 * lockstep with the existing lifetime counters on Trader.sim -
 * negativeBalanceEventCount/maxNegativeBalanceUsd - which stay untouched;
 * this is purely additive so day-by-day stats can be computed, which the
 * lifetime-only counters can't answer on their own ("how many times today",
 * "how deep today").
 */
const NegativeBalanceEventSchema = new Schema({
  traderAddress: { type: String, required: true, index: true },
  occurredAt: { type: Date, default: Date.now },
  balanceUsd: { type: Number, required: true }, // the resulting (negative) balance at this moment
  depthUsd: { type: Number, required: true }, // abs(balanceUsd) - how deep, always positive
});

NegativeBalanceEventSchema.index({ traderAddress: 1, occurredAt: -1 });

export const NegativeBalanceEvent =
  models.NegativeBalanceEvent || model("NegativeBalanceEvent", NegativeBalanceEventSchema);
