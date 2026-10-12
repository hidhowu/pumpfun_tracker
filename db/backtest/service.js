import { BacktestAddress } from "../models/BacktestAddress.js";
import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { BacktestScan } from "../models/BacktestScan.js";
import { Trader } from "../models/Trader.js";
import { Profile } from "../models/Profile.js";
import { getGlobalSettings } from "../models/GlobalSettings.js";
import { getSystemSettings } from "../models/SystemSettings.js";
import { resolveBacktestSettings } from "./settings.js";
import { addTradersBulk, isValidSolanaAddress, setBlacklisted } from "../traderService.js";
import { traderProgressPercent, runProgressPercent, estimateRemainingMs } from "./progress.js";
import { getRunAddress as getRunAddressDetail } from "./addressView.js";

const DAY_MS = 86_400_000;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BACKTEST_DAYS = 120;
export const DEFAULT_MAX_SIGNATURES = 50_000;
const ACTIVE_STATUSES = ["queued", "running"];

// ------------------------------------------------------------ addresses

/**
 * Bulk add to the backtest list. Same conventions as the live trader list:
 * duplicates are skipped (and reported), malformed addresses are rejected
 * into `invalid`, and one bad entry never stops the rest.
 * An entry may carry the wallet's pump.fun `userId` (what makes collection fast); `walletAddress` is accepted as the address key too.
 * @param {Array<string|{address?: string, walletAddress?: string, label?: string, userId?: string}>} entries
 */
export async function addBacktestAddresses(entries, { source = "manual" } = {}) {
  const normalized = entries
    .map((e) =>
      typeof e === "string"
        ? { address: e.trim(), label: "", userId: "" }
        : { address: (e.address ?? e.walletAddress)?.trim(), label: e.label || "", userId: typeof e.userId === "string" ? e.userId.trim() : "" }
    )
    .filter((e) => e.address);

  const invalid = normalized.filter((e) => !isValidSolanaAddress(e.address) || (e.userId && !USER_ID.test(e.userId))).map((e) => e.address);
  const invalidSet = new Set(invalid);
  const seen = new Set();
  const valid = [];
  for (const e of normalized) {
    if (invalidSet.has(e.address) || seen.has(e.address)) continue;
    seen.add(e.address);
    valid.push(e);
  }

  // An address blacklisted from a past backtest (or from live trading) is never put back on the list - same rule as adding live traders.
  const blacklistedDocs = await Trader.find({ address: { $in: valid.map((e) => e.address) }, status: "blacklisted" }, { address: 1 }).lean();
  const blacklistedSet = new Set(blacklistedDocs.map((d) => d.address));
  const blacklisted = valid.filter((e) => blacklistedSet.has(e.address)).map((e) => e.address);
  const addable = valid.filter((e) => !blacklistedSet.has(e.address));

  const existing = await BacktestAddress.find({ address: { $in: addable.map((e) => e.address) } }, { address: 1, userId: 1 }).lean();
  const existingBy = new Map(existing.map((d) => [d.address, d]));
  const toInsert = addable.filter((e) => !existingBy.has(e.address));

  // Pasting an address that is already listed together with a user id gives it (or corrects) that id - so the list can be upgraded to the fast source in place.
  const updated = [];
  const skipped = [];
  for (const e of addable) {
    const have = existingBy.get(e.address);
    if (!have) continue;
    if (e.userId && e.userId !== (have.userId || "")) {
      await BacktestAddress.updateOne({ address: e.address }, { $set: { userId: e.userId } });
      updated.push(e.address);
    } else {
      skipped.push(e.address);
    }
  }

  let added = [];
  if (toInsert.length > 0) {
    try {
      const docs = await BacktestAddress.insertMany(
        toInsert.map((e) => ({ address: e.address, label: e.label, userId: e.userId, source })),
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
  return { added, updated, skipped, blacklisted, invalid };
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

/**
 * Blacklists addresses straight from the backtest list. The blacklist is the
 * platform's one shared list (the live Blacklisted page), so this:
 *  - adds an address that was never a live trader as a blacklisted one, so it
 *    can't be added to live trading - or back onto the backtest list - by
 *    accident later (both report it as blacklisted);
 *  - blacklists an address that IS an active live trader too, exactly as the
 *    live Blacklist button does (tracking stops, its open positions are sold);
 *  - removes the address from the backtest list. Past runs keep their results.
 * @param {string[]} addresses
 */
export async function blacklistBacktestAddresses(addresses) {
  const unique = [...new Set(addresses.filter((a) => typeof a === "string" && isValidSolanaAddress(a)))];
  const [listed, live] = await Promise.all([
    BacktestAddress.find({ address: { $in: unique } }, { address: 1, label: 1 }).lean(),
    Trader.find({ address: { $in: unique } }, { address: 1, status: 1 }).lean(),
  ]);
  const labelBy = new Map(listed.map((l) => [l.address, l.label || ""]));
  const liveBy = new Map(live.map((t) => [t.address, t.status]));

  const result = { blacklisted: [], alreadyBlacklisted: [], liveBlacklisted: [], closingPositions: 0 };
  for (const address of unique) {
    const status = liveBy.get(address);
    if (status === "blacklisted") {
      result.alreadyBlacklisted.push(address);
    } else if (status === "active") {
      const { closingPositions } = await setBlacklisted(address, true);
      result.liveBlacklisted.push(address);
      result.closingPositions += closingPositions;
    } else {
      try {
        await Trader.create({ address, label: labelBy.get(address) || "", status: "blacklisted", blacklistedAt: new Date() });
      } catch (err) {
        if (err?.code !== 11000) throw err; // created by a concurrent request - already blacklisted or tracked; make sure it ends up blacklisted
        await setBlacklisted(address, true);
      }
      result.blacklisted.push(address);
    }
  }
  await BacktestAddress.deleteMany({ address: { $in: unique } });
  return result;
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
  const [system, backtest] = await Promise.all([getSystemSettings(), resolveBacktestSettings()]);
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
    // How often live looks at open positions (stop-loss / take-profit / trailing / max hold are only ever decided on those looks) - one system-wide setting today.
    riskCheckIntervalSeconds: system.riskCheckIntervalSeconds ?? 7,
    // Extra seconds between a trader's trade and our order, measured from live (see BacktestSettings.fillLatencySeconds).
    fillLatencySeconds: backtest.effective.fillLatencySeconds,
    pumpFeePercent: g.defaultPumpFeePercent ?? 1.25,
    jitoFeeUsd: g.defaultJitoFeeUsd ?? 0,
  };
}

/** The timing settings that may be overridden per backtest. Anything else comes from the profile. [min, max] in seconds; 0 on the interval = look at every pool trade. */
const TIMING_LIMITS = { executionDelaySeconds: [0, 60], riskCheckIntervalSeconds: [0, 3600], fillLatencySeconds: [0, 60] };

/** Keeps only valid timing overrides. Throws on a value that is present but unusable, so a typo is never silently ignored. */
function cleanTiming(overrides) {
  const out = {};
  for (const [key, [lo, hi]] of Object.entries(TIMING_LIMITS)) {
    const v = overrides?.[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${key} must be a number between ${lo} and ${hi}`);
    out[key] = v;
  }
  return out;
}

/** The early-stop rules (see earlyStop.js) with every field present; 0 = rule off. Throws on a value that is present but unusable. */
const EARLY_STOP_LIMITS = { lossDays: [0, 1000, true], dayLossPercent: [0, 1_000_000, false], negativeBalanceEvents: [0, 100_000, true], lossAtProgressPercent: [0, 100, false] };
function cleanEarlyStop(input, base = {}) {
  const out = {};
  for (const [key, [lo, hi, whole]] of Object.entries(EARLY_STOP_LIMITS)) {
    const v = input?.[key];
    if (v === undefined || v === null || v === "") {
      out[key] = base[key] ?? 0;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) {
      throw new Error(`${key} must be ${whole ? "a whole number" : "a number"} between ${lo} and ${hi} (0 = off)`);
    }
    out[key] = v;
  }
  return out;
}

/** "Addresses at once" for one run: null / "" / 0 = automatic. */
function cleanParallelism(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "" || v === 0) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 500) throw new Error("Addresses at once must be a whole number between 1 and 500 (empty = automatic)");
  return v;
}

/** @param {{name: string, days: number, profileId: string, addresses: string[], maxSignatures?: number, overrides?: object, earlyStop?: object, addressParallelism?: number|null}} p  maxSignatures: skip an address with more signatures than this in the window (0 = no limit); overrides: timing values (see TIMING_LIMITS) that replace the profile's */
export async function createBacktestRun({ name, days, profileId, addresses, maxSignatures = DEFAULT_MAX_SIGNATURES, overrides, earlyStop, addressParallelism }) {
  if (!Number.isFinite(days) || days < 1 || days > MAX_BACKTEST_DAYS) throw new Error(`days must be between 1 and ${MAX_BACKTEST_DAYS}`);
  if (!Number.isFinite(maxSignatures) || maxSignatures < 0) throw new Error("The signature limit must be 0 (no limit) or a positive number");
  const timing = cleanTiming(overrides);
  const stopRules = cleanEarlyStop(earlyStop);
  const parallelism = cleanParallelism(addressParallelism) ?? null;
  const unique = [...new Set(addresses)];
  if (unique.length === 0) throw new Error("Select at least one address");
  const profile = await Profile.findById(profileId).lean();
  if (!profile) throw new Error("Profile not found");

  // Only addresses actually on the backtest list can be run.
  const known = await BacktestAddress.find({ address: { $in: unique } }, { address: 1, userId: 1 }).lean();
  const knownSet = new Set(known.map((k) => k.address));
  const userIdBy = new Map(known.map((k) => [k.address, k.userId || ""]));
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
    settings: { ...(await snapshotProfileSettings(profile._id)), ...timing },
    addresses: runAddresses,
    maxSignatures: Math.floor(maxSignatures),
    earlyStop: stopRules,
    addressParallelism: parallelism,
    status: "queued",
  });
  await BacktestRunTrader.insertMany(runAddresses.map((address) => ({ runId: run._id, address, userId: userIdBy.get(address) || "" })));
  return run;
}

const FRESH_SIM = {
  "sim.done": false,
  "sim.signalsTotal": 0,
  "sim.signalsDone": 0,
  "sim.simulatedThrough": null,
  "sim.skipped": { dust: 0, noData: 0, insufficientBalance: 0, unresolved: 0, error: 0 },
};

/** Puts addresses that ended in `stage` back to "pending" so the worker picks them up again. Returns how many. */
async function requeueAddresses(runId, stage, extraFilter = {}) {
  const res = await BacktestRunTrader.updateMany(
    { runId, stage, ...extraFilter },
    { $set: { stage: "pending", stopReason: null, error: null, claimedBy: null, leaseUntil: null, finishedAt: null, "collect.listing": false } }
  );
  return res.modifiedCount || 0;
}

/** Throws away a run's simulated trades and puts its finished addresses back to "simulating" work - what a settings change needs. Collected transactions are kept. */
async function resetSimulation(runId) {
  await BacktestPosition.deleteMany({ runId });
  await BacktestRunTrader.updateMany(
    { runId, $or: [{ stage: { $in: ["done", "simulating"] } }, { stage: "skipped", stopReason: { $ne: null } }] }, // stopped-early traders are judged again on the new numbers
    { $set: { stage: "pending", stopReason: null, error: null, claimedBy: null, leaseUntil: null, finishedAt: null, ...FRESH_SIM } }
  );
}

/** pause | resume | cancel | retry_failed | retry_skipped */
export async function controlBacktestRun(runId, action) {
  const run = await BacktestRun.findById(runId);
  if (!run) throw new Error("Backtest not found");
  if (action === "pause") {
    if (!ACTIVE_STATUSES.includes(run.status)) throw new Error("Only a queued or running backtest can be paused");
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "pause" } });
  } else if (action === "resume") {
    // A cancelled backtest keeps everything it finished (and the addresses it hadn't reached), so it can be picked up again exactly like a paused one.
    if (run.status !== "paused" && run.status !== "cancelled") throw new Error("Only a paused or cancelled backtest can be resumed");
    await BacktestRunTrader.updateMany({ runId, claimedBy: { $ne: null } }, { $set: { claimedBy: null, leaseUntil: null } });
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued", finishedAt: null, error: null } });
  } else if (action === "cancel") {
    if (!["queued", "running", "paused"].includes(run.status)) throw new Error("This backtest has already finished");
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "cancel", status: run.status === "paused" ? "cancelled" : run.status, finishedAt: run.status === "paused" ? new Date() : null } });
  } else if (action === "retry_failed") {
    const res = await BacktestRunTrader.updateMany(
      { runId, stage: "failed" },
      { $set: { stage: "pending", error: null, claimedBy: null, leaseUntil: null, finishedAt: null } }
    );
    if (res.modifiedCount > 0) await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued", finishedAt: null, error: null } });
  } else if (action === "retry_skipped") {
    if (ACTIVE_STATUSES.includes(run.status)) throw new Error("Pause the backtest first");
    const n = await requeueAddresses(runId, "skipped"); // includes the ones stopped early: they continue unless the rules still stop them
    if (n === 0) throw new Error("No skipped addresses to retry");
    if (run.status === "completed" || run.status === "failed") {
      await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued", finishedAt: null, error: null } });
    }
  } else {
    throw new Error("Unknown action");
  }
  return BacktestRun.findById(runId).lean();
}

/**
 * Edits a backtest. The name can change any time; everything else needs the
 * backtest paused, cancelled or finished:
 *  - maxSignatures: the per-address signature limit. Raising it (or removing
 *    it with 0) puts the addresses that were skipped for being over the old
 *    limit back in the queue.
 *  - profileId: re-copies that profile's CURRENT settings into the backtest.
 *    Every result so far was simulated with the old settings, so the results
 *    are cleared and every finished address is simulated again - the
 *    transactions already collected are reused, so it is much faster than
 *    the first time.
 *  - overrides: timing values (executionDelaySeconds, riskCheckIntervalSeconds, fillLatencySeconds). A changed value clears and re-simulates the results too.
 * A finished backtest that gets work queued this way is set to "paused" - press
 * Resume to run it. (A cancelled or paused one stays as it is.)
 * @param {string} runId
 *  - earlyStop: the loss-trader rules (see earlyStop.js). Needs a pause. Changing them puts the traders already stopped early back in the queue, to be judged on the new rules; results are kept.
 *  - addressParallelism: how many addresses of this backtest are worked at once (null = automatic). May change while it runs.
 * @param {{name?: string, maxSignatures?: number, profileId?: string, overrides?: object, earlyStop?: object, addressParallelism?: number|null}} patch
 */
export async function updateBacktestRun(runId, { name, maxSignatures, profileId, overrides, earlyStop, addressParallelism } = {}) {
  const run = await BacktestRun.findById(runId);
  if (!run) throw new Error("Backtest not found");
  const set = {};
  if (typeof name === "string" && name.trim()) set.name = name.trim();

  const timing = cleanTiming(overrides);
  const changesTiming = Object.keys(timing).some((k) => run.settings?.[k] !== timing[k]);
  const changesSettings = maxSignatures !== undefined || profileId || changesTiming || earlyStop !== undefined;
  if (changesSettings && ACTIVE_STATUSES.includes(run.status)) throw new Error("Pause the backtest before editing its settings");

  let requeuedSkipped = 0;
  let resimulated = false;
  // The number of addresses worked at once is read by the worker every couple of seconds, so it may change while the backtest runs.
  const parallelism = cleanParallelism(addressParallelism);
  if (parallelism !== undefined) set.addressParallelism = parallelism;

  if (maxSignatures !== undefined) {
    if (!Number.isFinite(maxSignatures) || maxSignatures < 0) throw new Error("The signature limit must be 0 (no limit) or a positive number");
    const next = Math.floor(maxSignatures);
    const prev = run.maxSignatures || 0;
    set.maxSignatures = next;
    // Skipped addresses only make sense to retry when the limit got looser.
    if (prev > 0 && (next === 0 || next > prev)) requeuedSkipped = await requeueAddresses(runId, "skipped", { stopReason: null });
  }

  if (earlyStop !== undefined) {
    const current = run.toObject().earlyStop ?? {};
    const next = cleanEarlyStop(earlyStop, current);
    const prev = cleanEarlyStop(current);
    if (Object.keys(next).some((k) => next[k] !== prev[k])) {
      set.earlyStop = next;
      // Traders already dropped under the old rules get judged again under the new ones.
      requeuedSkipped += await requeueAddresses(runId, "skipped", { stopReason: { $ne: null } });
    }
  }

  if (profileId) {
    const profile = await Profile.findById(profileId).lean();
    if (!profile) throw new Error("Profile not found");
    set.profileId = profile._id;
    set.profileName = profile.name;
    set.settings = { ...(await snapshotProfileSettings(profile._id)), ...timing };
    await resetSimulation(runId);
    resimulated = true;
  } else if (changesTiming) {
    set.settings = { ...run.settings, ...timing };
    await resetSimulation(runId);
    resimulated = true;
  }

  if ((requeuedSkipped > 0 || resimulated) && (run.status === "completed" || run.status === "failed")) {
    set.status = "paused";
    set.control = "run";
    set.finishedAt = null;
    set.error = null;
  }
  if (Object.keys(set).length > 0) await BacktestRun.updateOne({ _id: runId }, { $set: set });
  return { run: await BacktestRun.findById(runId).lean(), requeuedSkipped, resimulated };
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

async function statsByAddress(runId, address) {
  const rows = await BacktestPosition.aggregate([{ $match: address ? { runId, address } : { runId } }, { $group: { _id: "$address", ...POSITION_STATS_GROUP } }]);
  return new Map(rows.map((r) => [r._id, finishStats(r)]));
}

/** One address of a run: its progress, stats and simulated wallet - for the address page. */
export function getRunAddress(runId, address) {
  return getRunAddressDetail(runId, address, { statsFor: async (rid, addr) => (await statsByAddress(rid, addr)).get(addr) ?? EMPTY_STATS });
}

export { getRunAddressPnl } from "./addressView.js";

function runProgress(run, runTraders) {
  const percent = run.status === "completed" ? 100 : runProgressPercent(runTraders);
  const settled = runTraders.filter((rt) => rt.stage === "done" || rt.stage === "failed" || rt.stage === "skipped").length;
  return {
    percent,
    addressesTotal: runTraders.length,
    addressesDone: runTraders.filter((rt) => rt.stage === "done").length,
    addressesFailed: runTraders.filter((rt) => rt.stage === "failed").length,
    addressesSkipped: runTraders.filter((rt) => rt.stage === "skipped").length,
    addressesStoppedEarly: runTraders.filter((rt) => rt.stage === "skipped" && rt.stopReason).length, // part of addressesSkipped: dropped as loss traders
    addressesSettled: settled,
    etaMs: ACTIVE_STATUSES.includes(run.status) ? estimateRemainingMs(percent, run.activeMs || 0) : null,
  };
}

/** Every run with its progress and headline numbers - for the Runs tab. */
export async function listBacktestRuns() {
  const [runs, runTraders, totals] = await Promise.all([
    BacktestRun.find({}).sort({ createdAt: -1 }).lean(),
    BacktestRunTrader.find({}, { runId: 1, stage: 1, stopReason: 1, collect: 1, sim: 1 }).lean(),
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
    progressPercent: traderProgressPercent(rt),
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
      .sort(status === "closed" ? { closedAt: -1, signalTime: -1 } : { openedAt: -1, signalTime: -1 })
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
    through[rt.address] = rt.stage === "done" || rt.stage === "failed" || rt.stage === "skipped" ? null : rt.sim?.simulatedThrough ? dayKey(rt.sim.simulatedThrough) : "";
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
