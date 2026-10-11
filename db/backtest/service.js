import { BacktestAddress } from "../models/BacktestAddress.js";
import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { BacktestScan } from "../models/BacktestScan.js";
import { Trader } from "../models/Trader.js";
import { Profile } from "../models/Profile.js";
import { getGlobalSettings } from "../models/GlobalSettings.js";
import { addTradersBulk, isValidSolanaAddress } from "../traderService.js";
import { traderProgressPercent, runProgressPercent, estimateRemainingMs } from "./progress.js";

const DAY_MS = 86_400_000;
export const MAX_BACKTEST_DAYS = 120;
const ACTIVE_STATUSES = ["queued", "running"];

// ------------------------------------------------------------ addresses

/**
 * Bulk add to the backtest list. Same conventions as the live trader list:
 * duplicates are skipped (and reported), malformed addresses are rejected
 * into `invalid`, and one bad entry never stops the rest.
 * @param {Array<string|{address: string, label?: string}>} entries
 */
export async function addBacktestAddresses(entries, { source = "manual" } = {}) {
  const normalized = entries
    .map((e) => (typeof e === "string" ? { address: e.trim(), label: "" } : { address: e.address?.trim(), label: e.label || "" }))
    .filter((e) => e.address);

  const invalid = normalized.filter((e) => !isValidSolanaAddress(e.address)).map((e) => e.address);
  const seen = new Set();
  const valid = [];
  for (const e of normalized) {
    if (!isValidSolanaAddress(e.address) || seen.has(e.address)) continue;
    seen.add(e.address);
    valid.push(e);
  }

  const existing = await BacktestAddress.find({ address: { $in: valid.map((e) => e.address) } }, { address: 1 }).lean();
  const existingSet = new Set(existing.map((d) => d.address));
  const toInsert = valid.filter((e) => !existingSet.has(e.address));
  const skipped = valid.filter((e) => existingSet.has(e.address)).map((e) => e.address);

  let added = [];
  if (toInsert.length > 0) {
    try {
      const docs = await BacktestAddress.insertMany(
        toInsert.map((e) => ({ address: e.address, label: e.label, source })),
        { ordered: false }
      );
      added = docs.map((d) => d.address);
    } catch (err) {
      if (err?.code !== 11000 && !err?.writeErrors) throw err;
      const inserted = new Set((err.insertedDocs || []).map((d) => d.address));
      added = toInsert.filter((e) => inserted.has(e.address)).map((e) => e.address);
      skipped.push(...toInsert.filter((e) => !inserted.has(e.address)).map((e) => e.address));
    }
  }
  return { added, skipped, invalid };
}

/** Copies live traders (optionally just one list's) onto the backtest list. The live Trader documents are untouched. */
/** @param {{listId?: string}} [opts] */
export async function importTradersToBacktest({ listId } = {}) {
  const filter = { status: "active" };
  if (listId) filter.listIds = listId;
  const traders = await Trader.find(filter, { address: 1, label: 1 }).lean();
  return addBacktestAddresses(
    traders.map((t) => ({ address: t.address, label: t.label || "" })),
    { source: listId ? "list" : "traders" }
  );
}

export async function removeBacktestAddresses(addresses) {
  const res = await BacktestAddress.deleteMany({ address: { $in: addresses } });
  return res.deletedCount || 0;
}

export async function updateBacktestAddress(address, { label, notes }) {
  const update = {};
  if (typeof label === "string") update.label = label;
  if (typeof notes === "string") update.notes = notes;
  return BacktestAddress.findOneAndUpdate({ address }, { $set: update }, { returnDocument: "after" });
}

/** The backtest list, each address with how much of its history is already cached and how many runs used it. */
export async function listBacktestAddresses() {
  const [addresses, scans, runCounts, liveTraders] = await Promise.all([
    BacktestAddress.find({}).sort({ addedAt: -1 }).lean(),
    BacktestScan.find({}).lean(),
    BacktestRun.aggregate([{ $unwind: "$addresses" }, { $group: { _id: "$addresses", runs: { $sum: 1 } } }]),
    Trader.find({}, { address: 1, status: 1 }).lean(),
  ]);
  const scanBy = new Map(scans.map((s) => [s.address, s]));
  const runsBy = new Map(runCounts.map((r) => [r._id, r.runs]));
  const liveBy = new Map(liveTraders.map((t) => [t.address, t.status]));
  return addresses.map((a) => {
    const scan = scanBy.get(a.address);
    return {
      ...a,
      cachedFrom: scan ? new Date(scan.coverFrom * 1000) : null,
      cachedTo: scan ? new Date(scan.coverTo * 1000) : null,
      runCount: runsBy.get(a.address) || 0,
      liveStatus: liveBy.get(a.address) ?? null, // "active" | "blacklisted" | null (not a live trader)
    };
  });
}

// ----------------------------------------------------------------- runs

/** The profile's settings as the strategy a backtest follows - frozen into the run. */
export async function snapshotProfileSettings(profileId) {
  const g = (await getGlobalSettings(profileId)).toObject();
  return {
    allocationUsd: g.defaultAllocationUsd,
    tradeSizeUsd: g.defaultTradeSizeUsd,
    dustBuyUsd: g.defaultDustBuyUsd,
    dustSellFractionPercent: g.defaultDustSellFractionPercent,
    stopLossPercent: g.defaultStopLossPercent ?? null,
    takeProfitPercent: g.defaultTakeProfitPercent ?? null,
    maxTradeTimeSeconds: g.defaultMaxTradeTimeSeconds ?? 0,
    trailingStops: (g.defaultTrailingStops || []).map((r) => ({ _id: String(r._id), armPercent: r.armPercent, exitPercent: r.exitPercent })),
    allowNegativeBalance: g.defaultAllowNegativeBalance !== false,
    executionDelaySeconds: g.defaultExecutionDelaySeconds ?? 2,
    pumpFeePercent: g.defaultPumpFeePercent ?? 1.25,
    jitoFeeUsd: g.defaultJitoFeeUsd ?? 0,
  };
}

/** @param {{name: string, days: number, profileId: string, addresses: string[]}} p */
export async function createBacktestRun({ name, days, profileId, addresses }) {
  if (!Number.isFinite(days) || days < 1 || days > MAX_BACKTEST_DAYS) throw new Error(`days must be between 1 and ${MAX_BACKTEST_DAYS}`);
  const unique = [...new Set(addresses)];
  if (unique.length === 0) throw new Error("Select at least one address");
  const profile = await Profile.findById(profileId).lean();
  if (!profile) throw new Error("Profile not found");

  // Only addresses actually on the backtest list can be run.
  const known = await BacktestAddress.find({ address: { $in: unique } }, { address: 1 }).lean();
  const knownSet = new Set(known.map((k) => k.address));
  const runAddresses = unique.filter((a) => knownSet.has(a));
  if (runAddresses.length === 0) throw new Error("None of the selected addresses are on the backtest list");

  const now = Date.now();
  const run = await BacktestRun.create({
    name: name?.trim() || `${days}-day backtest`,
    days,
    windowStart: new Date(now - days * DAY_MS),
    windowEnd: new Date(now),
    profileId: profile._id,
    profileName: profile.name,
    settings: await snapshotProfileSettings(profile._id),
    addresses: runAddresses,
    status: "queued",
  });
  await BacktestRunTrader.insertMany(runAddresses.map((address) => ({ runId: run._id, address })));
  return run;
}

/** pause | resume | cancel | retry_failed */
export async function controlBacktestRun(runId, action) {
  const run = await BacktestRun.findById(runId);
  if (!run) throw new Error("Backtest not found");
  if (action === "pause") {
    if (!ACTIVE_STATUSES.includes(run.status)) throw new Error("Only a queued or running backtest can be paused");
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "pause" } });
  } else if (action === "resume") {
    if (run.status !== "paused") throw new Error("Only a paused backtest can be resumed");
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued" } });
  } else if (action === "cancel") {
    if (!["queued", "running", "paused"].includes(run.status)) throw new Error("This backtest has already finished");
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "cancel", status: run.status === "paused" ? "cancelled" : run.status, finishedAt: run.status === "paused" ? new Date() : null } });
  } else if (action === "retry_failed") {
    const res = await BacktestRunTrader.updateMany(
      { runId, stage: "failed" },
      { $set: { stage: "pending", error: null, claimedBy: null, leaseUntil: null, finishedAt: null } }
    );
    if (res.modifiedCount > 0) await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued", finishedAt: null, error: null } });
  } else {
    throw new Error("Unknown action");
  }
  return BacktestRun.findById(runId).lean();
}

export async function deleteBacktestRun(runId) {
  const run = await BacktestRun.findById(runId);
  if (!run) throw new Error("Backtest not found");
  if (ACTIVE_STATUSES.includes(run.status) && run.control === "run") throw new Error("Pause or cancel the backtest before deleting it");
  await Promise.all([BacktestPosition.deleteMany({ runId }), BacktestRunTrader.deleteMany({ runId })]);
  await BacktestRun.deleteOne({ _id: runId });
}

// ---------------------------------------------------------------- stats

const POSITION_STATS_GROUP = {
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

function finishStats(row) {
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

const EMPTY_STATS = finishStats(null);

async function statsByAddress(runId) {
  const rows = await BacktestPosition.aggregate([{ $match: { runId } }, { $group: { _id: "$address", ...POSITION_STATS_GROUP } }]);
  return new Map(rows.map((r) => [r._id, finishStats(r)]));
}

function runProgress(run, runTraders) {
  const percent = run.status === "completed" ? 100 : runProgressPercent(runTraders);
  const settled = runTraders.filter((rt) => rt.stage === "done" || rt.stage === "failed").length;
  return {
    percent,
    addressesTotal: runTraders.length,
    addressesDone: runTraders.filter((rt) => rt.stage === "done").length,
    addressesFailed: runTraders.filter((rt) => rt.stage === "failed").length,
    addressesSettled: settled,
    etaMs: ACTIVE_STATUSES.includes(run.status) ? estimateRemainingMs(percent, run.activeMs || 0) : null,
  };
}

/** Every run with its progress and headline numbers - for the Runs tab. */
export async function listBacktestRuns() {
  const [runs, runTraders, totals] = await Promise.all([
    BacktestRun.find({}).sort({ createdAt: -1 }).lean(),
    BacktestRunTrader.find({}, { runId: 1, stage: 1, collect: 1, sim: 1 }).lean(),
    BacktestPosition.aggregate([{ $group: { _id: "$runId", ...POSITION_STATS_GROUP } }]),
  ]);
  const tradersBy = new Map();
  for (const rt of runTraders) {
    const key = String(rt.runId);
    if (!tradersBy.has(key)) tradersBy.set(key, []);
    tradersBy.get(key).push(rt);
  }
  const totalsBy = new Map(totals.map((t) => [String(t._id), finishStats(t)]));
  return runs.map((run) => ({
    ...run,
    progress: runProgress(run, tradersBy.get(String(run._id)) || []),
    stats: totalsBy.get(String(run._id)) ?? EMPTY_STATS,
  }));
}

/** One run: definition, progress, headline numbers, and every address with its own progress and partial results. */
export async function getBacktestRun(runId) {
  const run = await BacktestRun.findById(runId).lean();
  if (!run) return null;
  const [runTraders, byAddress, labels, totalsRows] = await Promise.all([
    BacktestRunTrader.find({ runId }).lean(),
    statsByAddress(run._id),
    BacktestAddress.find({ address: { $in: run.addresses } }, { address: 1, label: 1 }).lean(),
    BacktestPosition.aggregate([{ $match: { runId: run._id } }, { $group: { _id: null, ...POSITION_STATS_GROUP } }]),
  ]);
  const labelBy = new Map(labels.map((l) => [l.address, l.label]));
  const traders = runTraders.map((rt) => ({
    address: rt.address,
    label: labelBy.get(rt.address) || "",
    stage: rt.stage,
    error: rt.error,
    progressPercent: rt.stage === "failed" ? 100 : traderProgressPercent(rt),
    collect: rt.collect,
    sim: rt.sim,
    stats: byAddress.get(rt.address) ?? EMPTY_STATS,
  }));
  return {
    run,
    progress: runProgress(run, runTraders),
    stats: finishStats(totalsRows[0] ?? null),
    traders,
  };
}

// ------------------------------------------------------ positions / daily

/** @param {string} runId @param {{address?: string, status?: string, page?: number, limit?: number}} [opts] */
export async function listRunPositions(runId, { address, status, page = 1, limit = 25 } = {}) {
  const match = { runId };
  if (address) match.address = address;
  if (status === "closed" || status === "open" || status === "skipped") match.status = status;
  else match.status = { $ne: "skipped" };
  const [positions, total] = await Promise.all([
    BacktestPosition.find(match)
      .sort({ openedAt: -1, signalTime: -1 })
      .skip((Math.max(1, page) - 1) * limit)
      .limit(limit)
      .lean(),
    BacktestPosition.countDocuments(match),
  ]);
  return { positions, page, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Per-day results of the positions closed so far, by UTC day of the exit.
 * `through` is, per address, the instant before which everything has been
 * simulated - so the UI can tell a finished day from one that is still filling in.
 */
export async function getRunDaily(runId) {
  const run = await BacktestRun.findById(runId).lean();
  if (!run) return null;
  const [rows, runTraders] = await Promise.all([
    BacktestPosition.aggregate([
      { $match: { runId: run._id, status: "closed" } },
      {
        $group: {
          _id: { address: "$address", day: { $dateToString: { format: "%Y-%m-%d", date: "$closedAt", timezone: "UTC" } } },
          pnlUsd: { $sum: "$realizedPnlUsd" },
          combinedPercent: { $sum: "$realizedPnlPercent" },
          trades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $gt: ["$realizedPnlUsd", 0] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $lt: ["$realizedPnlUsd", 0] }, 1, 0] } },
        },
      },
    ]),
    BacktestRunTrader.find({ runId }, { address: 1, stage: 1, "sim.simulatedThrough": 1, "sim.done": 1 }).lean(),
  ]);

  const days = [];
  for (let t = Date.parse(`${dayKey(run.windowStart)}T00:00:00Z`); t <= run.windowEnd.getTime(); t += DAY_MS) days.push(dayKey(t));

  const byAddress = {};
  for (const r of rows) {
    (byAddress[r._id.address] ??= {})[r._id.day] = {
      pnlUsd: r.pnlUsd,
      combinedPercent: r.combinedPercent,
      trades: r.trades,
      wins: r.wins,
      losses: r.losses,
    };
  }
  const through = {};
  for (const rt of runTraders) {
    through[rt.address] = rt.stage === "done" || rt.stage === "failed" ? null : rt.sim?.simulatedThrough ? dayKey(rt.sim.simulatedThrough) : "";
  }
  // `through[address]`: null = fully simulated; "" = nothing simulated yet; "YYYY-MM-DD" = days strictly before it are complete.
  return { days, byAddress, through };
}

/** Cumulative realized P&L over time, as chart points (downsampled). */
/** @param {string} runId @param {{address?: string}} [opts] */
export async function getRunEquity(runId, { address } = {}) {
  const match = { runId, status: "closed" };
  if (address) match.address = address;
  const closed = await BacktestPosition.find(match, { closedAt: 1, realizedPnlUsd: 1 }).sort({ closedAt: 1 }).lean();
  let cumulative = 0;
  const points = closed.map((p, i) => {
    cumulative += p.realizedPnlUsd || 0;
    return { t: p.closedAt, cumulativeUsd: cumulative, n: i + 1 };
  });
  const MAX_POINTS = 400;
  if (points.length <= MAX_POINTS) return { points };
  const step = points.length / MAX_POINTS;
  const sampled = [];
  for (let i = 0; i < MAX_POINTS; i++) sampled.push(points[Math.floor(i * step)]);
  sampled.push(points[points.length - 1]);
  return { points: sampled };
}

/** Adds backtest addresses to the LIVE trader list (duplicate-protected, blacklisted ones are not revived). */
export async function promoteToLiveTraders(addresses) {
  const labels = await BacktestAddress.find({ address: { $in: addresses } }, { address: 1, label: 1 }).lean();
  const labelBy = new Map(labels.map((l) => [l.address, l.label || ""]));
  return addTradersBulk(addresses.map((address) => ({ address, label: labelBy.get(address) || "" })));
}
