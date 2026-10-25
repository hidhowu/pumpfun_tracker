import { logEvent } from "../systemLog.js";

/**
 * Crash-safe building blocks for fills. MongoDB here is a plain standalone server (no transactions), so a fill - which
 * touches a balance, a position, counters and the queue entry - can't be one all-or-nothing write. Instead every fill is
 *
 *   1. PLANNED: the exact numbers (price, size, fees, the new position's id) are written onto the queue entry
 *      BEFORE any money moves;
 *   2. APPLIED in small steps, each of which is IDEMPOTENT - it can run twice and the second run changes nothing -
 *      because the change and its key ("buy:<queue id>") are written in the same single-document update;
 *   3. RESUMED if the process dies half-way: a queue entry whose lease ran out is put back in the queue and the same
 *      steps run again with the same plan, skipping what already happened.
 *
 * Result: a crash can no longer debit money without a position, close a position without crediting it, or open a free
 * position - at worst a fill is finished a little late.
 */

/** How long a claimed queue entry may stay "processing" before it counts as abandoned. Longer than the slowest price retry chain. */
export const LEASE_MS = 90_000;
const MAX_KEYS = 400;
/** An entry resumed this many times is still failing - stop and raise an error instead of looping forever. */
export const MAX_REAPS = 5;
export const MAX_ERROR_RETRIES = { buy: 2, sell: 10 };

/**
 * Applies `update` to the document matching `filter` at most once per `key`. The key is recorded in `path` in the SAME
 * update, so "applied" and "recorded" can never disagree. Returns the updated document, or null when the filter didn't
 * match (condition not met, or this key was already applied - use wasApplied() to tell them apart).
 */
export async function applyOnce(Model, filter, key, update, { path = "appliedOps" } = {}) {
  const push = { ...(update.$push || {}), [path]: { $each: [key], $slice: -MAX_KEYS } };
  return Model.findOneAndUpdate({ ...filter, [path]: { $ne: key } }, { ...update, $push: push }, { returnDocument: "after" });
}

export async function wasApplied(Model, filter, key, { path = "appliedOps" } = {}) {
  return !!(await Model.exists({ ...filter, [path]: key }));
}

/** Stores the plan on the queue entry if none is stored yet; returns the plan that ended up stored (first writer wins). */
export async function savePlan(PendingModel, pending, plan) {
  const updated = await PendingModel.findOneAndUpdate(
    { _id: pending._id, status: "processing", fill: null },
    { $set: { fill: plan } },
    { returnDocument: "after" }
  );
  if (updated) return updated.fill;
  const current = await PendingModel.findById(pending._id, { fill: 1 }).lean();
  return current?.fill ?? plan;
}

export function leaseExpiry() {
  return new Date(Date.now() + LEASE_MS);
}

export function backoffMs(attempt) {
  return Math.min(60_000, 1000 * 2 ** attempt);
}

// ---- failure handling -----------------------------------------------------


function describe(item) {
  return `${item.action} of ${item.mint} for ${item.traderAddress}`;
}

async function skipWithReason(PendingModel, item, reason) {
  await PendingModel.updateOne({ _id: item._id }, { $set: { status: "skipped", skipReason: reason, processedAt: new Date(), leaseUntil: null } });
}

/**
 * An exception inside a fill. It is NOT the end of that fill: the plan and the idempotent steps make a re-run safe, so the
 * entry goes back in the queue with a growing delay (sells get many more tries - dropping one would leave a position open
 * with no exit). Only after the retries are used up is it skipped, and then it is logged as an ERROR, not a quiet skip.
 * The raw exception text goes to the log only, never into the stored skip reason.
 * `max` (retries) and `backoff` (attempt -> ms) override the defaults - the live wallets retry faster than the simulation does.
 */
export async function failOrRetry(PendingModel, item, err, { max: maxRetries, backoff = backoffMs } = {}) {
  const attempt = (item.errorAttempts || 0) + 1;
  const max = maxRetries ?? MAX_ERROR_RETRIES[item.action] ?? 2;
  const detail = err instanceof Error ? err.message : String(err);
  const meta = { traderAddress: item.traderAddress, mint: item.mint, action: item.action, attempt, error: detail };

  if (attempt <= max) {
    try {
      await PendingModel.updateOne(
        { _id: item._id },
        { $set: { status: "pending", triggerAt: new Date(Date.now() + backoff(attempt)), leaseUntil: null }, $inc: { errorAttempts: 1 } }
      );
      logEvent("trade", `Retrying ${describe(item)} after an error (attempt ${attempt}/${max})`, { level: "warn", meta });
      return "retry";
    } catch (requeueErr) {
      if (requeueErr?.code !== 11000) throw requeueErr;
      // a newer entry for the same thing is already queued - this one is obsolete
      await skipWithReason(PendingModel, item, "superseded by a newer queued entry");
      return "skipped";
    }
  }
  await skipWithReason(PendingModel, item, "internal error after retries (see the log)");
  logEvent("trade", `GAVE UP on ${describe(item)} after ${max} retries`, { level: "error", meta });
  return "skipped";
}

/**
 * Queue entries still "processing" after their lease ran out belong to a run that died (crash, restart, hung RPC).
 * Put them back in the queue: the fill resumes from its saved plan. An entry reaped too many times is skipped and logged as an error.
 */
export async function reapStale(PendingModel) {
  const now = new Date();
  const staleFilter = { status: "processing", $or: [{ leaseUntil: { $lt: now } }, { leaseUntil: null }] };
  const stale = await PendingModel.find(staleFilter).limit(50);
  for (const item of stale) {
    if ((item.reaped || 0) >= MAX_REAPS) {
      await skipWithReason(PendingModel, item, "abandoned mid-fill too many times (see the log)");
      logEvent("trade", `GAVE UP on ${describe(item)}: abandoned mid-fill ${item.reaped} times`, { level: "error", meta: { traderAddress: item.traderAddress, mint: item.mint } });
      continue;
    }
    try {
      const res = await PendingModel.updateOne(
        { _id: item._id, ...staleFilter },
        { $set: { status: "pending", triggerAt: now, leaseUntil: null }, $inc: { reaped: 1 } }
      );
      if (res.modifiedCount) logEvent("trade", `Resuming ${describe(item)} (the run that claimed it died)`, { level: "warn", meta: { traderAddress: item.traderAddress, mint: item.mint } });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      await skipWithReason(PendingModel, item, "superseded by a newer queued entry");
    }
  }
  return stale.length;
}
