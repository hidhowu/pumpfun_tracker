import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { summariseDays } from "./dayStats.js";

/**
 * Results of a run, kept where they are cheap to read.
 *
 * An address's figures (P&L, win rate, loss days, ...) used to be worked out from its positions every time the page asked - for every
 * address of the run, every few seconds. With thousands of addresses that is the whole position collection read over and over. Now
 * the worker writes each address's figures onto its BacktestRunTrader row as it goes (refreshAddressStats), so the page filters, sorts
 * and pages the addresses with an ordinary query, and a run's totals are one pass over its rows.
 */

export const POSITION_STATS_GROUP = {
  closed: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
  open: { $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] } },
  skipped: { $sum: { $cond: [{ $eq: ["$status", "skipped"] }, 1, 0] } },
  wins: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "closed"] }, { $gt: ["$realizedPnlUsd", 0] }] }, 1, 0] } },
  losses: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "closed"] }, { $lt: ["$realizedPnlUsd", 0] }] }, 1, 0] } },
  realizedPnlUsd: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, "$realizedPnlUsd", 0] } },
  combinedPercent: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, "$realizedPnlPercent", 0] } },
  bestPercent: { $max: { $cond: [{ $eq: ["$status", "closed"] }, "$realizedPnlPercent", null] } },
  worstPercent: { $min: { $cond: [{ $eq: ["$status", "closed"] }, "$realizedPnlPercent", null] } },
  unrealizedUsd: { $sum: { $cond: [{ $eq: ["$status", "open"] }, "$unrealizedPnlUsd", 0] } },
};

export function finishStats(row) {
  const decided = (row?.wins || 0) + (row?.losses || 0);
  const closed = row?.closed || 0;
  return {
    closed,
    open: row?.open || 0,
    skipped: row?.skipped || 0,
    wins: row?.wins || 0,
    losses: row?.losses || 0,
    winRatePercent: decided > 0 ? (row.wins / decided) * 100 : null,
    realizedPnlUsd: row?.realizedPnlUsd || 0,
    combinedPercent: row?.combinedPercent || 0,
    avgPercent: closed > 0 ? row.combinedPercent / closed : null,
    bestPercent: row?.bestPercent ?? null,
    worstPercent: row?.worstPercent ?? null,
    unrealizedUsd: row?.unrealizedUsd || 0,
  };
}

export const EMPTY_STATS = { ...finishStats(null), daily: summariseDays([]) };

/** Per address: the headline stats plus the day-by-day quality figures (loss days, profit margin, without the best day). `runId` must be an ObjectId. */
export async function statsByAddress(runId, address) {
  const match = address ? { runId, address } : { runId };
  const [rows, dayRows] = await Promise.all([
    BacktestPosition.aggregate([{ $match: match }, { $group: { _id: "$address", ...POSITION_STATS_GROUP } }]),
    BacktestPosition.aggregate([
      { $match: { ...match, status: "closed", closedAt: { $ne: null } } },
      {
        $group: {
          _id: { address: "$address", day: { $dateToString: { format: "%Y-%m-%d", date: "$closedAt", timezone: "UTC" } } },
          pnlUsd: { $sum: "$realizedPnlUsd" },
          pct: { $sum: "$realizedPnlPercent" },
        },
      },
    ]),
  ]);
  const daysBy = new Map();
  for (const r of dayRows) {
    if (!daysBy.has(r._id.address)) daysBy.set(r._id.address, []);
    daysBy.get(r._id.address).push({ date: r._id.day, pnlUsd: r.pnlUsd || 0, pct: r.pct || 0 });
  }
  return new Map(rows.map((r) => [r._id, { ...finishStats(r), daily: summariseDays((daysBy.get(r._id) ?? []).sort((a, b) => (a.date < b.date ? -1 : 1))) }]));
}

/** The shape stored on a BacktestRunTrader: the stats plus the per-trade average the page sorts and filters on. */
export const toStoredStats = (stats) => ({ ...stats, avgPnlUsd: stats.closed > 0 ? stats.realizedPnlUsd / stats.closed : null });

/** What a row with nothing simulated yet holds. */
export const emptyStoredStats = () => toStoredStats(EMPTY_STATS);

/** A stored `stats` back to the shape the API returns (a row from before they were stored has none: nothing simulated). */
export function viewStats(stored) {
  if (!stored) return EMPTY_STATS;
  const { avgPnlUsd, ...rest } = stored;
  void avgPnlUsd;
  return { ...EMPTY_STATS, ...rest, daily: { ...EMPTY_STATS.daily, ...(rest.daily || {}) } };
}

/** Recomputes one address's stored stats from its positions. */
export async function refreshAddressStats(runId, address) {
  const stats = (await statsByAddress(runId, address)).get(address) ?? EMPTY_STATS;
  await BacktestRunTrader.updateOne({ runId, address }, { $set: { stats: toStoredStats(stats) } });
}

/**
 * Keeps one address's stored stats fresh while it is being simulated without hammering the database: at most one recompute every
 * `everyMs`, never two at once, and `final()` waits for any in flight so an older result can't land after the last one.
 */
export function statsRefresher(runId, address, everyMs = 3000) {
  let last = 0;
  let inflight = null;
  const run = () => {
    last = Date.now();
    inflight = refreshAddressStats(runId, address)
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
  return {
    maybe() {
      if (!inflight && Date.now() - last >= everyMs) run();
    },
    async final() {
      if (inflight) await inflight;
      await run();
    },
  };
}

const CHUNK = 1000;

/** Writes the stored stats of every address of a run from its positions - for runs made before the stats were kept on the rows. */
export async function backfillRunStats(runId) {
  const [stats, traders] = await Promise.all([statsByAddress(runId), BacktestRunTrader.find({ runId }, { address: 1 }).lean()]);
  for (let i = 0; i < traders.length; i += CHUNK) {
    const ops = traders.slice(i, i + CHUNK).map((t) => ({
      updateOne: { filter: { _id: t._id }, update: { $set: { stats: toStoredStats(stats.get(t.address) ?? EMPTY_STATS) } } },
    }));
    await BacktestRunTrader.bulkWrite(ops, { ordered: false });
  }
  await BacktestRun.updateOne({ _id: runId }, { $set: { statsVersion: 1 } });
}

const backfilling = new Map(); // runId -> promise, so two requests at once do the work once

/** Makes sure `run` (a lean BacktestRun) has its stats on the rows; does the one-time fill for an older run. */
export async function ensureRunStats(run) {
  if ((run.statsVersion ?? 0) >= 1) return;
  const key = String(run._id);
  if (!backfilling.has(key)) {
    backfilling.set(
      key,
      backfillRunStats(run._id).finally(() => backfilling.delete(key))
    );
  }
  await backfilling.get(key);
  run.statsVersion = 1;
}

// ------------------------------------------------------------------ progress

const COLLECT_WEIGHT = 0.35;
const n = (path) => ({ $ifNull: [path, 0] });

// db/backtest/progress.js (collectFraction / simFraction / traderProgressPercent) written as an aggregation expression, so a run's
// progress is worked out inside the database from its rows instead of loading them all into Node to add up.
const COLLECT_FRACTION = {
  $cond: [
    "$collect.done",
    1,
    {
      $cond: [
        "$collect.listing",
        0.02,
        {
          $cond: [
            { $gt: [n("$collect.signaturesToProcess"), 0] },
            { $add: [0.02, { $multiply: [0.98, { $min: [1, { $divide: [n("$collect.signaturesProcessed"), "$collect.signaturesToProcess"] }] }] }] },
            { $cond: [{ $or: [{ $gt: [n("$collect.signaturesFound"), 0] }, { $ne: ["$stage", "pending"] }] }, 0.02, 0] },
          ],
        },
      ],
    },
  ],
};
const SIM_FRACTION = {
  $cond: ["$sim.done", 1, { $cond: [{ $gt: [n("$sim.signalsTotal"), 0] }, { $min: [1, { $divide: [n("$sim.signalsDone"), "$sim.signalsTotal"] }] }, 0] }],
};
const PROGRESS_PERCENT = {
  $cond: [
    { $in: ["$stage", ["done", "failed", "skipped"]] },
    100,
    { $multiply: [100, { $add: [{ $multiply: [COLLECT_WEIGHT, COLLECT_FRACTION] }, { $multiply: [1 - COLLECT_WEIGHT, SIM_FRACTION] }] }] },
  ],
};

// ------------------------------------------------------------ cache that adapts to how slow the answer is

/**
 * The run-level figures (progress, totals, the filter counts, the day totals...) take a pass over the run's rows or positions. That is
 * nothing for a few thousand addresses and real work for a million. They are kept in this process so a page polling every few seconds -
 * or several tabs - read the same answer instead of each recomputing it, and the time they are kept GROWS WITH THE TIME THEY TOOK:
 * a figure that took 4 seconds to work out is not worked out again for 32, so the server is never busy recomputing for more than
 * about one eighth of the time however big the backtest is. Once it is older than that, the old answer is still returned at once
 * and a fresh one is worked out in the background (the page is never held up by it, and only one recomputation runs at a time).
 * Anything that changes a backtest through the web app drops its entries.
 */
const memo = new Map(); // `${runId}|${kind}` -> { at, value, tookMs, promise? }
const ACTIVE_TTL_MS = 4000; // a run being worked on: progress should look live
const IDLE_TTL_MS = 30_000; // a finished / paused run only changes through the web app, which invalidates
const SLOWNESS_FACTOR = 8; // kept for at least this many times as long as it took to work out
const MAX_TTL_MS = 5 * 60_000;
const STALE_GRACE = 6; // an answer up to this many TTLs old is still returned at once while a new one is worked out
const MAX_ENTRIES = 600;

export const summaryTtl = (status) => (status === "queued" || status === "running" || status === "paused" ? ACTIVE_TTL_MS : IDLE_TTL_MS);

export function invalidateRun(runId) {
  const id = String(runId);
  for (const key of memo.keys()) if (key.startsWith(`${id}|`)) memo.delete(key);
}

function prune() {
  if (memo.size <= MAX_ENTRIES) return;
  const oldest = [...memo.entries()].filter(([, e]) => !e.promise).sort((x, y) => (x[1].at ?? 0) - (y[1].at ?? 0));
  for (const [key] of oldest.slice(0, memo.size - MAX_ENTRIES)) memo.delete(key);
}

function startRefresh(key, load, previous) {
  const startedAt = Date.now();
  const promise = load().then(
    (value) => {
      memo.set(key, { at: Date.now(), value, tookMs: Date.now() - startedAt });
      prune();
      return value;
    },
    (err) => {
      if (previous) memo.set(key, previous); // keep serving the old answer; the next call tries again
      else memo.delete(key);
      throw err;
    }
  );
  memo.set(key, { ...(previous ?? {}), promise });
  return promise;
}

/**
 * The cached value for (run, kind), or `load()`'s result. `ttlMs` is the least time it is kept; a slow `load` is kept longer (see above).
 * Also returns how old the answer is (`ageMs`, 0 when just worked out) so the page can say when the figures are a little behind.
 */
export async function rememberedWithAge(runId, kind, ttlMs, load) {
  const key = `${String(runId)}|${kind}`;
  const hit = memo.get(key);
  if (hit && "value" in hit) {
    const ttl = Math.max(ttlMs, Math.min(MAX_TTL_MS, (hit.tookMs ?? 0) * SLOWNESS_FACTOR));
    const age = Date.now() - hit.at;
    if (age < ttl) return { value: hit.value, ageMs: age };
    if (age < ttl * STALE_GRACE) {
      if (!hit.promise) startRefresh(key, load, hit).catch(() => {}); // in the background; the caller does not wait
      return { value: hit.value, ageMs: age };
    }
  }
  if (hit?.promise) return { value: await hit.promise, ageMs: 0 };
  return { value: await startRefresh(key, load, null), ageMs: 0 };
}

export async function remembered(runId, kind, ttlMs, load) {
  return (await rememberedWithAge(runId, kind, ttlMs, load)).value;
}

const stageCount = (stage) => ({ $sum: { $cond: [{ $eq: ["$stage", stage] }, 1, 0] } });

/**
 * Address counts, mean progress and the summed results for several runs, in one pass over their rows done by the database.
 * @param {Array<{_id: any}>} runs
 * @returns {Promise<Map<string, {addressesTotal: number, addressesDone: number, addressesFailed: number, addressesSkipped: number, addressesStoppedEarly: number, percent: number, stats: object}>>}
 */
export async function summariseRuns(runs) {
  const out = new Map();
  for (const run of runs) {
    const id = String(run._id);
    const { value, ageMs } = await rememberedWithAge(run._id, "summary", summaryTtl(run.status), async () => (await summariseRunsNow([run])).get(id) ?? null);
    if (value) out.set(id, { ...value, ageMs });
  }
  return out;
}

async function summariseRunsNow(runs) {
  const rows = await BacktestRunTrader.aggregate([
    { $match: { runId: { $in: runs.map((r) => r._id) } } },
    {
      $group: {
        _id: "$runId",
        total: { $sum: 1 },
        done: stageCount("done"),
        failed: stageCount("failed"),
        skipped: stageCount("skipped"),
        stopped: { $sum: { $cond: [{ $and: [{ $eq: ["$stage", "skipped"] }, { $ne: [{ $ifNull: ["$stopReason", null] }, null] }] }, 1, 0] } },
        percent: { $avg: PROGRESS_PERCENT },
        closed: { $sum: "$stats.closed" },
        open: { $sum: "$stats.open" },
        positionsSkipped: { $sum: "$stats.skipped" },
        wins: { $sum: "$stats.wins" },
        losses: { $sum: "$stats.losses" },
        realizedPnlUsd: { $sum: "$stats.realizedPnlUsd" },
        combinedPercent: { $sum: "$stats.combinedPercent" },
        bestPercent: { $max: "$stats.bestPercent" },
        worstPercent: { $min: "$stats.worstPercent" },
        unrealizedUsd: { $sum: "$stats.unrealizedUsd" },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [
      String(r._id),
      {
        addressesTotal: r.total,
        addressesDone: r.done,
        addressesFailed: r.failed,
        addressesSkipped: r.skipped,
        addressesStoppedEarly: r.stopped,
        percent: r.percent ?? 0,
        stats: finishStats({ ...r, skipped: r.positionsSkipped }),
      },
    ])
  );
}
