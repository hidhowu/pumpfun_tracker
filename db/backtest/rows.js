import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { emptyStoredStats } from "./runStats.js";

/** The starting state of an address inside a backtest: nothing collected, nothing simulated. */
export const freshAddressState = () => ({
  stage: "pending",
  error: null,
  stopReason: null,
  claimedBy: null,
  leaseUntil: null,
  startedAt: null,
  finishedAt: null,
  collect: { done: false, source: null, listing: false, signaturesFound: 0, signaturesToProcess: 0, signaturesProcessed: 0, signaturesFailed: 0, tradesFound: 0 },
  sim: { done: false, signalsTotal: 0, signalsDone: 0, simulatedThrough: null, skipped: { dust: 0, noData: 0, insufficientBalance: 0, unresolved: 0, error: 0 } },
  stats: emptyStoredStats(),
});

/**
 * Adds addresses to a backtest as waiting rows, straight through the driver. Building each row as a Mongoose document costs more than the
 * insert itself (about 3,000 rows a second), which for hundreds of thousands of addresses is minutes; plain documents go ten times faster.
 * Addresses already in the backtest are left alone (the unique index refuses them). Returns how many rows were really created.
 * @param {import("mongoose").Types.ObjectId} runId
 * @param {Array<{address: string, userId?: string}>} items
 */
export async function insertAddressRows(runId, items) {
  if (items.length === 0) return 0;
  const docs = items.map((k) => ({ runId, address: k.address, userId: k.userId || "", ...freshAddressState() }));
  try {
    const res = await BacktestRunTrader.collection.insertMany(docs, { ordered: false });
    return res.insertedCount ?? docs.length;
  } catch (err) {
    // Duplicates (already in this backtest) are refused one by one; everything else still went in.
    if (err?.code !== 11000 && !err?.writeErrors) throw err;
    const refused = Array.isArray(err.writeErrors) ? err.writeErrors.length : (err.result?.writeErrors?.length ?? 0);
    return docs.length - refused;
  }
}
