import mongoose from "mongoose";
import { LiveTxStat } from "../../models/LiveTxStat.js";
import { logEvent } from "../../systemLog.js";

/**
 * The live wallet's transaction stats: how fast its transactions land (from the moment a trade starts being built to the moment it is first
 * on the chain), how many succeed, fail or are retried. Recording is bookkeeping and never allowed to disturb a trade: it swallows its own errors.
 */

/** Records one attempt. `startedAt` / `sentAt` / `landedAt` are Unix ms (sentAt / landedAt may be missing). */
export async function recordTx({ item, live, outcome, error = null, tx = null, startedAt, sentAt = null, landedAt = null, signature = null }) {
  try {
    const filter = signature ? { executionId: item._id, signature, outcome } : null;
    const fields = {
      liveWalletId: live._id,
      executionId: item._id,
      action: item.action,
      mint: item.mint,
      traderAddress: item.traderAddress,
      closeReason: item.action === "sell" ? item.closeReason : null,
      attempt: (item.errorAttempts || 0) + 1,
      sendMode: tx?.sendMode ?? null,
      route: tx?.route ?? null,
      signature,
      outcome,
      error: error ? String(error).slice(0, 300) : null,
      startedAt: new Date(startedAt),
      sentAt: sentAt ? new Date(sentAt) : null,
      landedAt: landedAt ? new Date(landedAt) : null,
      buildMs: sentAt ? Math.max(0, sentAt - startedAt) : null,
      // Only a transaction that was really sent by this run has a trustworthy speed (one found already landed after a restart does not).
      totalMs: sentAt && landedAt ? Math.max(0, landedAt - startedAt) : null,
      at: new Date(),
    };
    if (filter) await LiveTxStat.updateOne(filter, { $setOnInsert: fields }, { upsert: true });
    else await LiveTxStat.create(fields);
  } catch (err) {
    logEvent("trade", `[live] Couldn't record transaction stats: ${err instanceof Error ? err.message : err}`, { level: "warn" });
  }
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export function latencyOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, minMs: null, maxMs: null, avgMs: null, p10Ms: null, p50Ms: null, p90Ms: null, p95Ms: null, p99Ms: null };
  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    avgMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p10Ms: percentile(sorted, 10),
    p50Ms: percentile(sorted, 50),
    p90Ms: percentile(sorted, 90),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

const RECENT_WINDOW = 20;
const MAX_ROWS = 20_000;

/**
 * Everything the stats section shows for one live wallet.
 * @param {string} liveId
 * @param {{ hours?: number | null }} [options] only attempts from the last `hours` hours (null = all of them)
 */
export async function getTxStats(liveId, { hours = null } = {}) {
  if (!mongoose.isValidObjectId(liveId)) return null;
  const match = { liveWalletId: new mongoose.Types.ObjectId(liveId), ...(hours ? { at: { $gte: new Date(Date.now() - hours * 3_600_000) } } : {}) };
  const rows = await LiveTxStat.find(match, { executionId: 1, action: 1, attempt: 1, sendMode: 1, outcome: 1, totalMs: 1, buildMs: 1, at: 1, mint: 1, error: 1, route: 1, signature: 1, closeReason: 1 })
    .sort({ at: -1 })
    .limit(MAX_ROWS)
    .lean();

  const count = (list, outcome) => list.filter((r) => r.outcome === outcome).length;
  const summary = (list) => {
    const executions = new Map(); // one trade (queue entry) can take several attempts
    for (const r of list) {
      const e = executions.get(String(r.executionId)) ?? { attempts: 0, ok: false };
      e.attempts += 1;
      e.ok ||= r.outcome === "success";
      executions.set(String(r.executionId), e);
    }
    const trades = executions.size;
    const succeeded = [...executions.values()].filter((e) => e.ok).length;
    return {
      attempts: list.length,
      success: count(list, "success"),
      reverted: count(list, "reverted"),
      expired: count(list, "expired"),
      error: count(list, "error"),
      retries: list.filter((r) => r.attempt > 1).length,
      trades,
      tradesSucceeded: succeeded,
      tradesFailed: trades - succeeded, // gave up, or still being retried
      successRate: list.length ? (count(list, "success") / list.length) * 100 : null,
    };
  };

  const times = (list) => list.filter((r) => r.outcome === "success" && r.totalMs != null).map((r) => r.totalMs);
  const successes = rows.filter((r) => r.outcome === "success" && r.totalMs != null); // newest first
  const all = latencyOf(times(rows));
  const recent = latencyOf(successes.slice(0, RECENT_WINDOW).map((r) => r.totalMs));
  // Slowing down: the last few transactions take clearly longer than the usual (needs enough of both to mean anything).
  const slowing = all.count >= 30 && recent.count >= 10 && all.p50Ms > 0 && recent.p50Ms > all.p50Ms * 1.5;

  const byMode = {};
  for (const mode of ["raw", "jito"]) byMode[mode] = { ...summary(rows.filter((r) => r.sendMode === mode)), latency: latencyOf(times(rows.filter((r) => r.sendMode === mode))) };

  const failures = rows.filter((r) => r.outcome !== "success").slice(0, 15);
  return {
    hours,
    total: summary(rows),
    buy: { ...summary(rows.filter((r) => r.action === "buy")), latency: latencyOf(times(rows.filter((r) => r.action === "buy"))) },
    sell: { ...summary(rows.filter((r) => r.action === "sell")), latency: latencyOf(times(rows.filter((r) => r.action === "sell"))) },
    latency: all,
    recentLatency: recent,
    recentWindow: RECENT_WINDOW,
    slowing,
    byMode,
    recentFailures: failures.map((r) => ({ at: r.at, action: r.action, mint: r.mint, outcome: r.outcome, attempt: r.attempt, error: r.error, sendMode: r.sendMode, signature: r.signature })),
  };
}
