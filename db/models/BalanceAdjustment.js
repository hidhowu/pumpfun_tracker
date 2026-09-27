import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/** Audit trail for manual balance top-ups (or deductions) from the dashboard. */
const BalanceAdjustmentSchema = new Schema({
  traderAddress: { type: String, required: true, index: true },
  amountUsd: { type: Number, required: true }, // signed
  reason: { type: String, default: "" },
  balanceAfterUsd: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const BalanceAdjustment = models.BalanceAdjustment || model("BalanceAdjustment", BalanceAdjustmentSchema);
