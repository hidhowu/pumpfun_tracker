import mongoose from "mongoose";
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
import { traderProgressPercent, estimateRemainingMs } from "./progress.js";
import { getRunAddress as getRunAddressDetail } from "./addressView.js";
import { byQueueOrder } from "./queue.js";
import { freshAddressState, insertAddressRows } from "./rows.js";
import { addTradersToList } from "../listService.js";
import { deleteViewsOfRun } from "./views.js";
import { MAX_JITO_FEE_USD, MAX_PUMP_FEE_PERCENT } from "../settingsLimits.js";
import { EMPTY_STATS, STATS_VERSION, emptyStoredStats, ensureRunStats, finishStats, invalidateRun, remembered, rememberedWithAge, statsByAddress, summariseRuns, summaryTtl, viewStats } from "./runStats.js";

const DAY_MS = 86_400_000;
const INSERT_CHUNK = 5000;
// Addresses are added in batches this big (the page sends them that way too); a bigger request is refused so one call can't hold the server.
export const ADD_BATCH = 5000;
export const MAX_ADD_REQUEST = 10_000;
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
  const userIdOps = [];
  for (const e of addable) {
    const have = existingBy.get(e.address);
    if (!have) continue;
    if (e.userId && e.userId !== (have.userId || "")) {
      userIdOps.push({ updateOne: { filter: { address: e.address }, update: { $set: { userId: e.userId } } } });
      updated.push(e.address);
    } else {
      skipped.push(e.address);
    }
  }
  if (userIdOps.length > 0) await BacktestAddress.bulkWrite(userIdOps, { ordered: false });

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

/**
 * Copies live traders (optionally just one list's) onto the backtest list. The live Trader documents are untouched.
 * ONE PAGE per call: pass the `nextAfterId` of the previous answer to get the next page (null = that was the last one). `total` (first page only)
 * is how many traders there are, for a progress bar.
 * @param {{listId?: string, afterId?: string|null, limit?: number}} [opts]
 */
export async function importTradersToBacktest({ listId, afterId = null, limit = ADD_BATCH } = {}) {
  const filter = { status: "active" };
  if (listId) filter.listIds = listId;
  const pageSize = Math.min(MAX_ADD_REQUEST, Math.max(1, Math.floor(limit) || ADD_BATCH));
  const total = afterId ? undefined : await Trader.countDocuments(filter);
  const page = afterId ? { ...filter, _id: { $gt: new mongoose.Types.ObjectId(String(afterId)) } } : filter;
  const traders = await Trader.find(page, { address: 1, label: 1 }).sort({ _id: 1 }).limit(pageSize).lean();
  const res = await addBacktestAddresses(
    traders.map((t) => ({ address: t.address, label: t.label || "" })),
    { source: listId ? "list" : "traders" }
  );
  return { ...res, scanned: traders.length, total, nextAfterId: traders.length === pageSize ? String(traders.at(-1)._id) : null };
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
  const fresh = []; // never a live trader: just added to the blacklist, all in one insert
  for (const address of unique) {
    const status = liveBy.get(address);
    if (status === "blacklisted") {
      result.alreadyBlacklisted.push(address);
    } else if (status === "active") {
      const { closingPositions } = await setBlacklisted(address, true);
      result.liveBlacklisted.push(address);
      result.closingPositions += closingPositions;
    } else {
      fresh.push(address);
    }
  }
  if (fresh.length > 0) {
    const at = new Date();
    try {
      await Trader.insertMany(
        fresh.map((address) => ({ address, label: labelBy.get(address) || "", status: "blacklisted", blacklistedAt: at })),
        { ordered: false }
      );
    } catch (err) {
      if (err?.code !== 11000 && !err?.writeErrors) throw err;
      // Some were created by a concurrent request in the meantime: make sure those end up blacklisted too.
      const done = new Set((await Trader.find({ address: { $in: fresh }, status: "blacklisted" }, { address: 1 }).lean()).map((t) => t.address));
      for (const address of fresh) if (!done.has(address)) await setBlacklisted(address, true);
    }
    result.blacklisted.push(...fresh);
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

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mongo filter for the list's search box: the text anywhere in the address or the label, any case. */
export function addressSearchFilter(search) {
  const q = typeof search === "string" ? search.trim() : "";
  if (!q) return {};
  const re = new RegExp(escapeRegex(q), "i");
  return { $or: [{ address: re }, { label: re }] };
}

/**
 * One page of the backtest list (newest first), each address with how much of its history is already cached, how many runs used it and
 * whether it is a live trader. Only the page's addresses are looked up in the other collections - the list can hold tens of thousands.
 * `idsOnly` returns just the addresses that match the search, in list order, for "select everything that matches"; `skip` / `count` take only
 * a slice of them (rows skip+1 ... skip+count), for "select the first 2,500" or "rows 5,001 to 10,000". At most MAX_IDS.
 * @param {{page?: number, limit?: number, search?: string, idsOnly?: boolean, skip?: number, count?: number}} [opts]
 */
export async function listBacktestAddresses({ page = 1, limit = 50, search = "", idsOnly = false, skip = 0, count = MAX_IDS } = {}) {
  const filter = addressSearchFilter(search);
  if (idsOnly) {
    const rows = await BacktestAddress.find(filter, { address: 1 })
      .sort({ addedAt: -1, _id: -1 })
      .skip(Math.max(0, Math.floor(skip) || 0))
      .limit(Math.min(MAX_IDS, Math.max(1, Math.floor(count) || MAX_IDS)))
      .lean();
    return { addresses: rows.map((r) => r.address) };
  }
  const pageSize = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const [rows, total, totalAll] = await Promise.all([
    BacktestAddress.find(filter)
      .sort({ addedAt: -1, _id: -1 })
      .skip((pageNo - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    BacktestAddress.countDocuments(filter),
    BacktestAddress.estimatedDocumentCount(),
  ]);
  const inPage = rows.map((r) => r.address);
  const [scans, runCounts, liveTraders] = await Promise.all([
    BacktestScan.find({ address: { $in: inPage } }).lean(),
    BacktestRunTrader.aggregate([{ $match: { address: { $in: inPage } } }, { $group: { _id: "$address", runs: { $sum: 1 } } }]), // one row per (run, address): how many runs used it
    Trader.find({ address: { $in: inPage } }, { address: 1, status: 1 }).lean(),
  ]);
  const scanBy = new Map(scans.map((x) => [x.address, x]));
  const runsBy = new Map(runCounts.map((r) => [r._id, r.runs]));
  const liveBy = new Map(liveTraders.map((t) => [t.address, t.status]));
  return {
    addresses: rows.map((a) => {
      const scan = scanBy.get(a.address);
      return {
        ...a,
        cachedFrom: scan?.coverFrom != null ? new Date(scan.coverFrom * 1000) : null,
        cachedTo: scan?.coverTo != null ? new Date(scan.coverTo * 1000) : null,
        runCount: runsBy.get(a.address) || 0,
        liveStatus: liveBy.get(a.address) ?? null, // "active" | "blacklisted" | null (not a live trader)
      };
    }),
    total, // matching the search
    totalAll, // on the list
    page: pageNo,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

const MAX_IDS = 1_000_000;

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

/**
 * The settings that may be overridden per backtest instead of coming from the profile: the timing ([min, max] in seconds; 0 on the interval = look at
 * every pool trade) and, for a combined backtest, the trade amount and the fees. Anything else comes from the profile.
 */
const OVERRIDE_LIMITS = {
  executionDelaySeconds: [0, 60],
  riskCheckIntervalSeconds: [0, 3600],
  fillLatencySeconds: [0, 60],
  tradeSizeUsd: [0.01, 1_000_000_000],
  pumpFeePercent: [0, MAX_PUMP_FEE_PERCENT],
  jitoFeeUsd: [0, MAX_JITO_FEE_USD],
};

/** Keeps only valid overrides. Throws on a value that is present but unusable, so a typo is never silently ignored. */
function cleanOverrides(overrides) {
  const out = {};
  for (const [key, [lo, hi]] of Object.entries(OVERRIDE_LIMITS)) {
    const v = overrides?.[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${key} must be a number between ${lo} and ${hi}`);
    out[key] = v;
  }
  return out;
}

/** The shared wallet of a combined backtest. Every field present is checked; with `base` (the current values) missing ones keep theirs. */
function cleanCombined(input, base) {
  const startingBalanceUsd = input?.startingBalanceUsd ?? base?.startingBalanceUsd;
  if (typeof startingBalanceUsd !== "number" || !Number.isFinite(startingBalanceUsd) || startingBalanceUsd <= 0 || startingBalanceUsd > 1_000_000_000) {
    throw new Error("The starting balance must be a number above 0");
  }
  for (const key of ["resetDaily", "allowNegativeBalance"]) {
    if (input?.[key] !== undefined && typeof input[key] !== "boolean") throw new Error(`${key} must be true or false`);
  }
  return {
    startingBalanceUsd,
    resetDaily: input?.resetDaily ?? base?.resetDaily ?? false,
    allowNegativeBalance: input?.allowNegativeBalance ?? base?.allowNegativeBalance ?? true,
  };
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

/** "Days at once" for one run: undefined = not given, null / "" / 0 = no limit, otherwise a whole number of days. */
function cleanDaysAtOnce(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return 0;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1000) throw new Error("Days at once must be a whole number between 0 and 1000 (0 = no limit)");
  return v;
}

/** "Addresses at once" for one run: null / "" / 0 = automatic. */
function cleanParallelism(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "" || v === 0) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 500) throw new Error("Addresses at once must be a whole number between 1 and 500 (empty = automatic)");
  return v;
}

/**
 * @param {{name: string, days: number, profileId: string, addresses: string[], maxSignatures?: number, overrides?: object, earlyStop?: object, addressParallelism?: number|null, daysAtOnce?: number, mode?: "separate"|"combined", combined?: object, collectMethod?: "api"|"rpc", allAddresses?: boolean, search?: string}} p
 *   allAddresses: run every address on the backtest list (only those matching `search`, if given) - read by the server, so a huge list is never sent in a request;
 *   collectMethod: "api" reads each address's trades from pump.fun (fast, limited history), "rpc" lists its signatures over RPC and parses each transaction (slow, reaches further back);
 *   maxSignatures: skip an address with more signatures than this in the window (0 = no limit); overrides: values (see OVERRIDE_LIMITS) that replace the profile's;
 *   mode "combined": all addresses trade as one wallet - `combined` is { startingBalanceUsd, resetDaily?, allowNegativeBalance? } and the trade amount / fees come in `overrides`
 *   (tradeSizeUsd, pumpFeePercent, jitoFeeUsd). A combined backtest has no loss-trader rules: one address dropping out would change the wallet the others share.
 */
export async function createBacktestRun({ name, days, profileId, addresses = [], maxSignatures = DEFAULT_MAX_SIGNATURES, overrides, earlyStop, addressParallelism, daysAtOnce, mode = "separate", combined, collectMethod = "api", allAddresses = false, search = "" }) {
  if (!Number.isFinite(days) || days < 1 || days > MAX_BACKTEST_DAYS) throw new Error(`days must be between 1 and ${MAX_BACKTEST_DAYS}`);
  if (collectMethod !== "api" && collectMethod !== "rpc") throw new Error("collectMethod must be api or rpc");
  if (!Number.isFinite(maxSignatures) || maxSignatures < 0) throw new Error("The signature limit must be 0 (no limit) or a positive number");
  if (mode !== "separate" && mode !== "combined") throw new Error("mode must be separate or combined");
  const isCombined = mode === "combined";
  const wallet = isCombined ? cleanCombined(combined) : null;
  const timing = cleanOverrides(overrides);
  const stopRules = cleanEarlyStop(isCombined ? undefined : earlyStop);
  const parallelism = cleanParallelism(addressParallelism) ?? null;
  const days_ = cleanDaysAtOnce(daysAtOnce) ?? 0;
  const unique = allAddresses ? [] : [...new Set(addresses)];
  if (!allAddresses && unique.length === 0) throw new Error("Select at least one address");
  const profile = await Profile.findById(profileId).lean();
  if (!profile) throw new Error("Profile not found");

  // Only addresses actually on the backtest list can be run. They are read a chunk at a time (never all in memory, never one giant query).
  async function* onTheList() {
    if (allAddresses) {
      let rows = [];
      for await (const doc of BacktestAddress.find(addressSearchFilter(search), { address: 1, userId: 1 }).sort({ addedAt: -1, _id: -1 }).lean().cursor()) {
        rows.push(doc);
        if (rows.length >= INSERT_CHUNK) {
          yield rows;
          rows = [];
        }
      }
      if (rows.length > 0) yield rows;
      return;
    }
    for (let i = 0; i < unique.length; i += INSERT_CHUNK) {
      const slice = unique.slice(i, i + INSERT_CHUNK);
      const found = new Map((await BacktestAddress.find({ address: { $in: slice } }, { address: 1, userId: 1 }).lean()).map((k) => [k.address, k]));
      yield slice.filter((a) => found.has(a)).map((a) => found.get(a)); // in the order they were given
    }
  }

  const now = Date.now();
  const settings = { ...(await snapshotProfileSettings(profile._id)), ...(wallet ? { allocationUsd: wallet.startingBalanceUsd } : {}), ...timing };

  // The address rows go in BEFORE the run exists. The worker only looks at runs, so it can never meet a run whose addresses are still being
  // written: it used to see a "queued" run with nothing waiting yet, call it finished and never come back to it (thousands of addresses take
  // seconds to insert).
  const runId = new mongoose.Types.ObjectId();
  try {
    let count = 0;
    for await (const chunk of onTheList()) {
      if (chunk.length === 0) continue;
      count += await insertAddressRows(runId, chunk);
    }
    if (count === 0) throw new Error(allAddresses ? "There are no addresses on the backtest list" : "None of the selected addresses are on the backtest list");
    return await BacktestRun.create({
      _id: runId,
      name: name?.trim() || `${days}-day backtest`,
      days,
      windowStart: new Date(now - days * DAY_MS),
      windowEnd: new Date(now),
      profileId: profile._id,
      profileName: profile.name,
      // In a combined backtest the shared balance is the wallet's allocation.
      settings,
      mode,
      combined: wallet,
      addressCount: count,
      statsVersion: STATS_VERSION,
      maxSignatures: Math.floor(maxSignatures),
      collectMethod,
      earlyStop: stopRules,
      addressParallelism: parallelism,
      daysAtOnce: days_,
      status: "queued",
    });
  } catch (err) {
    await BacktestRunTrader.deleteMany({ runId }).catch(() => {});
    throw err;
  }
}

/**
 * Adds addresses to a backtest that already exists - running, queued, paused, or finished - so one backtest can keep growing instead of
 * a new one being made for every batch. Addresses already in it are left alone. The new ones wait like any other: a running backtest
 * just picks them up; a FINISHED one is set to paused, and Resume then works only through the new addresses (everything done stays done).
 *
 * Either pass `addresses` (at most MAX_ADD_REQUEST, all of which must be on the backtest list), or `fromList: true` to take everything on
 * the backtest list (matching `search`, if given) that is not in the backtest yet, ONE PAGE per call: pass the `nextAfterId` of the previous
 * answer to get the next page (null = that was the last one). The page loops, so a list of any size is never one long request.
 * @param {string} runId
 * @param {{addresses?: string[], fromList?: boolean, afterId?: string|null, search?: string, limit?: number}} opts
 */
export async function addAddressesToRun(runId, { addresses = [], fromList = false, afterId = null, search = "", limit = ADD_BATCH } = {}) {
  const run = await BacktestRun.findById(runId, { status: 1, control: 1, addressCount: 1 }).lean();
  if (!run) throw new Error("Backtest not found");

  let candidates;
  let notOnList = 0;
  let scanned;
  let nextAfterId = null;
  if (fromList) {
    const pageSize = Math.min(MAX_ADD_REQUEST, Math.max(1, Math.floor(limit) || ADD_BATCH));
    const filter = { ...addressSearchFilter(search), ...(afterId ? { _id: { $gt: new mongoose.Types.ObjectId(String(afterId)) } } : {}) };
    const rows = await BacktestAddress.find(filter, { address: 1, userId: 1 }).sort({ _id: 1 }).limit(pageSize).lean();
    candidates = rows;
    scanned = rows.length;
    nextAfterId = rows.length === pageSize ? String(rows.at(-1)._id) : null;
  } else {
    const unique = [...new Set(addresses)];
    if (unique.length === 0) throw new Error("Provide at least one address");
    if (unique.length > MAX_ADD_REQUEST) throw new Error(`Add at most ${MAX_ADD_REQUEST} addresses per request`);
    candidates = await BacktestAddress.find({ address: { $in: unique } }, { address: 1, userId: 1 }).lean();
    notOnList = unique.length - candidates.length;
    scanned = unique.length;
  }

  const inRun = new Set(
    (await BacktestRunTrader.find({ runId: run._id, address: { $in: candidates.map((c) => c.address) } }, { address: 1 }).lean()).map((r) => r.address)
  );
  const fresh = candidates.filter((c) => !inRun.has(c.address));
  const added = await insertAddressRows(run._id, fresh);

  if (added > 0) {
    if (typeof run.addressCount === "number") await BacktestRun.updateOne({ _id: run._id }, { $inc: { addressCount: added } });
    else await BacktestRun.updateOne({ _id: run._id }, { $set: { addressCount: await BacktestRunTrader.countDocuments({ runId: run._id }) } }); // an older backtest: count what is really there
    // Checked AFTER the rows exist, so a worker that finished the backtest a moment ago can't leave it "completed" with addresses waiting.
    await BacktestRun.updateOne(
      { _id: run._id, status: { $in: ["completed", "failed"] } },
      { $set: { status: "paused", control: "pause", finishedAt: null, error: null } }
    );
    invalidateRun(run._id);
  }
  const now = await BacktestRun.findById(run._id, { status: 1 }).lean();
  return { added, alreadyInRun: candidates.length - fresh.length, notOnList, scanned, nextAfterId, status: now?.status ?? run.status };
}

const FRESH_SIM = {
  "sim.done": false,
  "sim.signalsTotal": 0,
  "sim.signalsDone": 0,
  "sim.simulatedThrough": null,
  "sim.skipped": { dust: 0, noData: 0, insufficientBalance: 0, unresolved: 0, error: 0 },
  stats: emptyStoredStats(), // the positions are thrown away with it
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

/**
 * pause | resume | cancel | retry_failed | retry_skipped | restart
 *
 * restart: starts the whole backtest again from the first address - every result is thrown away and every address goes back to waiting.
 * The window, the settings and the addresses stay as they are, and the transactions already collected are kept (they are cached per
 * address), so it is much faster than the first time. Works from any state except while the worker is actively working on it (pause
 * first). `options.collectMethod` ("api" | "rpc") restarts it with the other way of reading the trades.
 * @param {string} runId
 * @param {string} action
 * @param {{collectMethod?: "api"|"rpc"}} [options]
 */
export async function controlBacktestRun(runId, action, options = {}) {
  const run = await BacktestRun.findById(runId);
  if (!run) throw new Error("Backtest not found");
  if (action === "restart") {
    if (ACTIVE_STATUSES.includes(run.status) && run.control === "run") throw new Error("Pause the backtest before restarting it");
    const { collectMethod } = options;
    if (collectMethod !== undefined && collectMethod !== "api" && collectMethod !== "rpc") throw new Error("collectMethod must be api or rpc");
    // A paused backtest hands its addresses back within a few seconds; restarting while one is still being wound down would let two workers share it.
    if ((await BacktestRunTrader.countDocuments({ runId, claimedBy: { $ne: null } })) > 0) throw new Error("The backtest is still stopping - try again in a few seconds");
    await BacktestPosition.deleteMany({ runId });
    await BacktestRunTrader.updateMany({ runId }, { $set: freshAddressState() });
    await BacktestRun.updateOne(
      { _id: runId },
      { $set: { control: "run", status: "queued", queuedAt: new Date(), error: null, startedAt: null, finishedAt: null, activeMs: 0, statsVersion: STATS_VERSION, ...(collectMethod ? { collectMethod } : {}) } }
    );
  } else if (action === "pause") {
    if (!ACTIVE_STATUSES.includes(run.status)) throw new Error("Only a queued or running backtest can be paused");
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "pause" } });
  } else if (action === "resume") {
    // A cancelled backtest keeps everything it finished (and the addresses it hadn't reached), so it can be picked up again exactly like a paused one.
    if (run.status !== "paused" && run.status !== "cancelled") throw new Error("Only a paused or cancelled backtest can be resumed");
    await BacktestRunTrader.updateMany({ runId, claimedBy: { $ne: null } }, { $set: { claimedBy: null, leaseUntil: null } });
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued", queuedAt: new Date(), finishedAt: null, error: null } });
  } else if (action === "cancel") {
    if (!["queued", "running", "paused"].includes(run.status)) throw new Error("This backtest has already finished");
    await BacktestRun.updateOne({ _id: runId }, { $set: { control: "cancel", status: run.status === "paused" ? "cancelled" : run.status, finishedAt: run.status === "paused" ? new Date() : null } });
  } else if (action === "retry_failed") {
    const res = await BacktestRunTrader.updateMany(
      { runId, stage: "failed" },
      { $set: { stage: "pending", error: null, claimedBy: null, leaseUntil: null, finishedAt: null } }
    );
    if (res.modifiedCount > 0) await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued", queuedAt: new Date(), finishedAt: null, error: null } });
  } else if (action === "retry_skipped") {
    if (ACTIVE_STATUSES.includes(run.status)) throw new Error("Pause the backtest first");
    const n = await requeueAddresses(runId, "skipped"); // includes the ones stopped early: they continue unless the rules still stop them
    if (n === 0) throw new Error("No skipped addresses to retry");
    if (run.status === "completed" || run.status === "failed") {
      await BacktestRun.updateOne({ _id: runId }, { $set: { control: "run", status: "queued", queuedAt: new Date(), finishedAt: null, error: null } });
    }
  } else {
    throw new Error("Unknown action");
  }
  invalidateRun(runId);
  return BacktestRun.findById(runId, RUN_FIELDS).lean();
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
 *  - overrides: timing values (executionDelaySeconds, riskCheckIntervalSeconds, fillLatencySeconds) and, for a combined backtest, tradeSizeUsd, pumpFeePercent and jitoFeeUsd.
 *    A changed value clears and re-simulates the results too.
 *  - combined (combined backtests only): the shared wallet { startingBalanceUsd, resetDaily, allowNegativeBalance }. The wallet is worked out from the finished trades
 *    each time it is read, so nothing is simulated again and it may change while the backtest runs. A profile re-copy keeps the trade amount and the starting balance.
 * A finished backtest that gets work queued this way is set to "paused" - press
 * Resume to run it. (A cancelled or paused one stays as it is.)
 * @param {string} runId
 *  - earlyStop: the loss-trader rules (see earlyStop.js). Needs a pause. Changing them puts the traders already stopped early back in the queue, to be judged on the new rules; results are kept.
 *  - addressParallelism: how many addresses of this backtest are worked at once (null = automatic). May change while it runs.
 *  - daysAtOnce: how many days of one address are worked at once (0 = no limit). May change while it runs - it only changes the order work is handed out in.
 * @param {{name?: string, maxSignatures?: number, profileId?: string, overrides?: object, earlyStop?: object, addressParallelism?: number|null, daysAtOnce?: number, combined?: object}} patch
 */
export async function updateBacktestRun(runId, { name, maxSignatures, profileId, overrides, earlyStop: earlyStopPatch, addressParallelism, daysAtOnce, combined } = {}) {
  const run = await BacktestRun.findById(runId);
  if (!run) throw new Error("Backtest not found");
  const isCombined = run.mode === "combined";
  if (combined !== undefined && !isCombined) throw new Error("Only a combined backtest has a shared wallet");
  const earlyStop = isCombined ? undefined : earlyStopPatch; // a combined backtest has no loss-trader rules
  const set = {};
  if (typeof name === "string" && name.trim()) set.name = name.trim();

  // The shared wallet: its balance is also the allocation shown with the strategy.
  let wallet = isCombined ? run.combined.toObject() : null;
  let walletChanged = false;
  if (combined !== undefined) {
    const next = cleanCombined(combined, wallet);
    walletChanged = Object.keys(next).some((k) => next[k] !== wallet[k]);
    wallet = next;
    if (walletChanged) set.combined = next;
  }
  const withWallet = (settings) => (wallet ? { ...settings, allocationUsd: wallet.startingBalanceUsd } : settings);

  const timing = cleanOverrides(overrides);
  const changesTiming = Object.keys(timing).some((k) => run.settings?.[k] !== timing[k]);
  const changesSettings = maxSignatures !== undefined || profileId || changesTiming || earlyStop !== undefined;
  if (changesSettings && ACTIVE_STATUSES.includes(run.status)) throw new Error("Pause the backtest before editing its settings");

  let requeuedSkipped = 0;
  let resimulated = false;
  // The number of addresses worked at once is read by the worker every couple of seconds, so it may change while the backtest runs.
  const parallelism = cleanParallelism(addressParallelism);
  if (parallelism !== undefined) set.addressParallelism = parallelism;
  const days = cleanDaysAtOnce(daysAtOnce);
  if (days !== undefined) set.daysAtOnce = days;

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
    // A combined backtest keeps its own trade amount; the fees are the new profile's unless they are overridden again.
    const kept = isCombined ? { tradeSizeUsd: run.settings.tradeSizeUsd } : {};
    set.settings = withWallet({ ...(await snapshotProfileSettings(profile._id)), ...kept, ...timing });
    await resetSimulation(runId);
    resimulated = true;
  } else if (changesTiming) {
    set.settings = withWallet({ ...run.settings, ...timing });
    await resetSimulation(runId);
    resimulated = true;
  } else if (walletChanged) {
    set.settings = withWallet(run.settings);
  }

  if ((requeuedSkipped > 0 || resimulated) && (run.status === "completed" || run.status === "failed")) {
    set.status = "paused";
    set.control = "run";
    set.finishedAt = null;
    set.error = null;
  }
  if (Object.keys(set).length > 0) await BacktestRun.updateOne({ _id: runId }, { $set: set });
  invalidateRun(runId);
  return { run: await BacktestRun.findById(runId, RUN_FIELDS).lean(), requeuedSkipped, resimulated };
}

export async function deleteBacktestRun(runId) {
  const run = await BacktestRun.findById(runId);
  if (!run) throw new Error("Backtest not found");
  if (ACTIVE_STATUSES.includes(run.status) && run.control === "run") throw new Error("Pause or cancel the backtest before deleting it");
  await Promise.all([BacktestPosition.deleteMany({ runId }), BacktestRunTrader.deleteMany({ runId }), deleteViewsOfRun(runId)]);
  await BacktestRun.deleteOne({ _id: runId });
  invalidateRun(runId);
}

// ---------------------------------------------------------------- stats

/** One address of a run: its progress, stats and simulated wallet - for the address page. */
export function getRunAddress(runId, address) {
  return getRunAddressDetail(runId, address, { statsFor: async (rid, addr) => (await statsByAddress(rid, addr)).get(addr) ?? EMPTY_STATS });
}

export { getRunAddressPnl } from "./addressView.js";

/** The run document as the API returns it: without the (legacy) address list, which can be tens of thousands of strings. */
const RUN_FIELDS = { addresses: 0 };
const withCount = (run, counted) => ({ ...run, addressCount: counted ?? run.addressCount ?? run.addresses?.length ?? 0 });

function runProgress(run, summary, queuePosition = null) {
  const total = summary?.addressesTotal ?? 0;
  const percent = run.status === "completed" ? 100 : (summary?.percent ?? 0);
  const done = summary?.addressesDone ?? 0;
  const failed = summary?.addressesFailed ?? 0;
  const skipped = summary?.addressesSkipped ?? 0;
  return {
    percent,
    addressesTotal: total,
    addressesDone: done,
    addressesFailed: failed,
    addressesSkipped: skipped,
    addressesStoppedEarly: summary?.addressesStoppedEarly ?? 0, // part of addressesSkipped: dropped as loss traders
    addressesSettled: done + failed + skipped,
    // 0 = being worked on (or next to be picked up), 1 = next in line, 2 = after that...; null = not in the line (paused, finished...)
    queuePosition,
    etaMs: ACTIVE_STATUSES.includes(run.status) && !(queuePosition > 0) ? estimateRemainingMs(percent, run.activeMs || 0) : null,
  };
}

/** The backtests waiting for or getting the worker, in the order they are worked on (the first is the one being worked on). */
async function queueOrder() {
  const rows = await BacktestRun.find({ status: { $in: ACTIVE_STATUSES }, control: "run" }, { queuedAt: 1, createdAt: 1 }).lean();
  return rows.sort(byQueueOrder).map((r) => String(r._id));
}

/** Where a backtest is in the line: 0 = being worked on (or next to be picked up), 1 = next, ...; null = not in the line. */
export async function getQueuePosition(runId) {
  const at = (await queueOrder()).indexOf(String(runId));
  return at < 0 ? null : at;
}

/** Every run with its progress and headline numbers - for the Runs tab. One pass over the runs' address rows, done by the database. */
export async function listBacktestRuns() {
  const runs = await BacktestRun.find({}, RUN_FIELDS).sort({ createdAt: -1 }).lean();
  for (const run of runs) await ensureRunStats(run);
  const [summaries, order] = await Promise.all([summariseRuns(runs), queueOrder()]);
  return runs.map((run) => {
    const summary = summaries.get(String(run._id));
    const at = order.indexOf(String(run._id));
    return { ...withCount(run, summary?.addressesTotal), progress: runProgress(run, summary, at < 0 ? null : at), stats: summary?.stats ?? EMPTY_STATS };
  });
}

/**
 * One run: definition, progress and headline numbers. The addresses are NOT in here - a run can have tens of thousands, so the page
 * asks for them a page at a time (listRunTraders).
 */
export async function getBacktestRun(runId) {
  const run = await BacktestRun.findById(runId, RUN_FIELDS).lean();
  if (!run) return null;
  await ensureRunStats(run);
  const [summaries, order] = await Promise.all([summariseRuns([run]), queueOrder()]);
  const summary = summaries.get(String(run._id));
  const at = order.indexOf(String(run._id));
  return { run: withCount(run, summary?.addressesTotal), progress: runProgress(run, summary, at < 0 ? null : at), stats: summary?.stats ?? finishStats(null) };
}

// ----------------------------------------------------- the addresses of a run

const TRADER_STAGES_RUNNING = ["pending", "collecting", "simulating"];

/** The run page's status filters. Every address is under exactly one of running / failed / skipped / done; profitable and losing split "done". */
const FILTER_QUERIES = {
  all: {},
  running: { stage: { $in: TRADER_STAGES_RUNNING } },
  failed: { stage: "failed" },
  skipped: { stage: "skipped" },
  profitable: { stage: "done", "stats.closed": { $gt: 0 }, "stats.realizedPnlUsd": { $gt: 0 } },
  losing: { stage: "done", "stats.closed": { $gt: 0 }, "stats.realizedPnlUsd": { $lt: 0 } },
};

const SORT_FIELDS = {
  pnl: "stats.realizedPnlUsd",
  combined: "stats.combinedPercent",
  avgPnl: "stats.avgPnlUsd",
  winRate: "stats.winRatePercent",
  trades: "stats.closed",
  lossDays: "stats.daily.lossDays",
  margin: "stats.daily.profitMarginPercent",
  withoutBest: "stats.daily.withoutBestDay.combinedPercent",
  avgPnlDay: "stats.daily.avgPnlPerDayUsd",
  profitDays: "stats.daily.profitDaysPercent",
  totalLoss: "stats.totalLossUsd",
  dayLoss: "stats.daily.grossLossPercent",
};

const finite = (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** "Contains this text" in the address (the index on runId + address is scanned, not the documents). */
function searchQuery(search) {
  const q = typeof search === "string" ? search.trim() : "";
  return q ? { address: { $regex: escapeRegex(q) } } : {};
}

/** The Mongo filter for a run's addresses: its status filter, the limits and the address search. `runId` must be an ObjectId. */
export function traderMatch(runId, { filter = "all", limits, search = "" } = {}) {
  return and({ runId }, FILTER_QUERIES[filter] ?? FILTER_QUERIES.all, limitQuery(limits), searchQuery(search));
}

/** The Mongo sort for a run's addresses. The tie-break goes the same way as the column, which is what its index is built for. */
export function traderSort(sort = "pnl", dir = "desc") {
  const direction = dir === "asc" ? 1 : -1;
  return { [SORT_FIELDS[sort] ?? SORT_FIELDS.pnl]: direction, _id: direction };
}

/** The "at least / at most" limits of the run page as a query (they match what the table used to do in the browser). */
function limitQuery(limits = {}) {
  const q = {};
  const minWin = finite(limits.minWinRate);
  const minMargin = finite(limits.minMargin);
  const maxLoss = finite(limits.maxLossDays);
  const minTrades = finite(limits.minTrades);
  const maxTrades = finite(limits.maxTrades);
  const minAvg = finite(limits.minAvgPnl);
  if (minWin != null) q["stats.winRatePercent"] = { $gte: minWin }; // no win rate yet never matches
  if (minMargin != null) q["stats.daily.profitMarginPercent"] = { $gte: minMargin };
  if (maxLoss != null) q["stats.daily.lossDays"] = { $not: { $gt: maxLoss } }; // none counted yet is 0 loss days
  if (minTrades != null || maxTrades != null) q["stats.closed"] = { ...(minTrades != null ? { $gte: minTrades } : {}), ...(maxTrades != null ? { $lte: maxTrades } : {}) };
  if (minAvg != null) q["stats.avgPnlUsd"] = { $gte: minAvg };
  const minPnl = finite(limits.minPnl);
  const minPerDay = finite(limits.minAvgPnlPerDay);
  const minProfitDays = finite(limits.minProfitDaysPercent);
  const maxTotalLoss = finite(limits.maxTotalLoss);
  if (minPnl != null) q["stats.realizedPnlUsd"] = { $gte: minPnl };
  if (minPerDay != null) q["stats.daily.avgPnlPerDayUsd"] = { $gte: minPerDay }; // no trading day yet never matches
  if (minProfitDays != null) q["stats.daily.profitDaysPercent"] = { $gte: minProfitDays };
  // Total loss on trades = every losing trade added up, in dollars. Total loss of days = the losing days' results added up (-30% and -40% -> 70).
  // Both are typed as positive numbers; no loss counted yet is a loss of 0.
  if (maxTotalLoss != null) q["stats.totalLossUsd"] = { $not: { $gt: Math.abs(maxTotalLoss) } };
  const maxDayLoss = finite(limits.maxDayLossPercent);
  if (maxDayLoss != null) q["stats.daily.grossLossPercent"] = { $not: { $gt: Math.abs(maxDayLoss) } };
  if (limits.holdsWithoutBest === true || limits.holdsWithoutBest === "true") q["stats.daily.withoutBestDay.stillProfitable"] = true;
  return q;
}

const and = (...parts) => {
  const real = parts.filter((p) => p && Object.keys(p).length > 0);
  return real.length === 0 ? {} : real.length === 1 ? real[0] : { $and: real };
};

/**
 * A page of a run's addresses, filtered and sorted by the database. `counts` is how many addresses are under each status filter
 * (ignoring the limits), for the filter buttons; `total` is how many match the current filter AND limits.
 * @param {string} runId
 * @param {{filter?: string, sort?: string, dir?: "asc"|"desc", page?: number, limit?: number, limits?: object, search?: string, addressesOnly?: boolean}} [opts]
 *   addressesOnly: just the addresses that match (up to MAX_ADDRESSES_ONLY), for "select everything that matches".
 *   search: text that must be in the address.
 * Every query has a time limit (QUERY_LIMIT_MS) and may use the disk to sort, so a backtest of hundreds of thousands of addresses can be filtered and
 * sorted without running the server out of memory; `tookMs` says how long the page itself took, for the page's estimate of slow queries.
 */
export async function listRunTraders(runId, { filter = "all", sort = "pnl", dir = "desc", page = 1, limit = 50, limits, search = "", addressesOnly = false } = {}) {
  const startedAt = Date.now();
  const run = await BacktestRun.findById(runId, RUN_FIELDS).lean();
  if (!run) return null;
  await ensureRunStats(run);
  const base = { runId: run._id };
  const match = traderMatch(run._id, { filter, limits, search });

  if (addressesOnly) {
    const rows = await BacktestRunTrader.find(match, { address: 1 }).sort({ _id: 1 }).limit(MAX_ADDRESSES_ONLY).maxTimeMS(QUERY_LIMIT_MS).lean();
    return { addresses: rows.map((r) => r.address), capped: rows.length >= MAX_ADDRESSES_ONLY };
  }

  const pageSize = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const unfiltered = !match.$and; // nothing but { runId } (any filter, limit or search makes it an $and): the count is the run's size
  const [rows, total, countsInfo] = await Promise.all([
    BacktestRunTrader.find(match)
      .sort(traderSort(sort, dir))
      .skip((pageNo - 1) * pageSize)
      .limit(pageSize)
      .allowDiskUse(true)
      .maxTimeMS(QUERY_LIMIT_MS)
      .lean(),
    // The size of the filtered set: kept for a while like the counts below (it only matters for the pager), and for the whole run it is just its size.
    unfiltered
      ? Promise.resolve(run.addressCount || BacktestRunTrader.countDocuments(match))
      : remembered(run._id, `total:${JSON.stringify(match)}`, summaryTtl(run.status), () => BacktestRunTrader.countDocuments(match).maxTimeMS(QUERY_LIMIT_MS)),
    // How many addresses are under each filter button: the same for every page and sort, so it is worked out once for a few seconds.
    rememberedWithAge(run._id, "filter-counts", summaryTtl(run.status), () =>
      BacktestRunTrader.aggregate([
        { $match: base },
        {
          $group: {
            _id: null,
            all: { $sum: 1 },
            running: { $sum: { $cond: [{ $in: ["$stage", TRADER_STAGES_RUNNING] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$stage", "failed"] }, 1, 0] } },
            skipped: { $sum: { $cond: [{ $eq: ["$stage", "skipped"] }, 1, 0] } },
            profitable: { $sum: { $cond: [{ $and: [{ $eq: ["$stage", "done"] }, { $gt: ["$stats.closed", 0] }, { $gt: ["$stats.realizedPnlUsd", 0] }] }, 1, 0] } },
            losing: { $sum: { $cond: [{ $and: [{ $eq: ["$stage", "done"] }, { $gt: ["$stats.closed", 0] }, { $lt: ["$stats.realizedPnlUsd", 0] }] }, 1, 0] } },
          },
        },
      ], { allowDiskUse: true, maxTimeMS: QUERY_LIMIT_MS })
    ),
  ]);
  const countRows = countsInfo.value;
  const labels = await BacktestAddress.find({ address: { $in: rows.map((r) => r.address) } }, { address: 1, label: 1 }).lean();
  const labelBy = new Map(labels.map((l) => [l.address, l.label]));
  const { _id, ...counts } = countRows[0] ?? { all: 0, running: 0, failed: 0, skipped: 0, profitable: 0, losing: 0 };
  void _id;
  return {
    traders: rows.map((rt) => ({
      address: rt.address,
      label: labelBy.get(rt.address) || "",
      stage: rt.stage,
      error: rt.error,
      progressPercent: traderProgressPercent(rt),
      collect: rt.collect,
      sim: rt.sim,
      stats: viewStats(rt.stats),
    })),
    total,
    page: pageNo,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts,
    countsAgeMs: countsInfo.ageMs, // how far behind the button counts are (they take a pass over the whole backtest, so a huge one refreshes them less often)
    tookMs: Date.now() - startedAt,
    runSize: run.addressCount || counts.all,
  };
}

const MAX_ADDRESSES_ONLY = 1_000_000;
// No query on a run's addresses may hold the database longer than this.
const QUERY_LIMIT_MS = 120_000;

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
const DAY_GROUP = { $dateToString: { format: "%Y-%m-%d", date: "$closedAt", timezone: "UTC" } };

/**
 * Per-day results of the positions closed so far, by UTC day of the exit - for ONE PAGE of the run's addresses (best P&L first), plus the
 * day totals of ALL addresses so the "All addresses" row stays complete.
 * `through` is, per address on the page, the instant before which everything has been simulated - so the UI can tell a finished day from
 * one that is still filling in.
 * @param {string} runId @param {{page?: number, limit?: number}} [opts]
 */
export async function getRunDaily(runId, { page = 1, limit = 50 } = {}) {
  const run = await BacktestRun.findById(runId, RUN_FIELDS).lean();
  if (!run) return null;
  await ensureRunStats(run);
  const pageSize = Math.min(200, Math.max(1, Math.floor(limit) || 50));
  const pageNo = Math.max(1, Math.floor(page) || 1);
  const [runTraders, total, unfinished, totalRows] = await Promise.all([
    BacktestRunTrader.find({ runId: run._id }, { address: 1, stage: 1, "sim.simulatedThrough": 1 })
      .sort({ "stats.realizedPnlUsd": -1, _id: -1 })
      .skip((pageNo - 1) * pageSize)
      .limit(pageSize)
      .maxTimeMS(QUERY_LIMIT_MS)
      .lean(),
    Promise.resolve(run.addressCount || BacktestRunTrader.countDocuments({ runId: run._id })),
    remembered(run._id, "unfinished", summaryTtl(run.status), () => BacktestRunTrader.countDocuments({ runId: run._id, stage: { $in: TRADER_STAGES_RUNNING } })),
    // Every closed trade of the backtest, added up per day: a pass over all its positions, so it is kept (longer, the slower it is) like the other totals.
    remembered(run._id, "day-totals", summaryTtl(run.status), () =>
      BacktestPosition.aggregate(
        [
          { $match: { runId: run._id, status: "closed" } },
          {
            $group: {
              _id: DAY_GROUP,
              pnlUsd: { $sum: "$realizedPnlUsd" },
              combinedPercent: { $sum: "$realizedPnlPercent" },
              trades: { $sum: 1 },
              wins: { $sum: { $cond: [{ $gt: ["$realizedPnlUsd", 0] }, 1, 0] } },
              losses: { $sum: { $cond: [{ $lt: ["$realizedPnlUsd", 0] }, 1, 0] } },
            },
          },
        ],
        { allowDiskUse: true, maxTimeMS: QUERY_LIMIT_MS }
      )
    ),
  ]);
  const addresses = runTraders.map((rt) => rt.address);
  const [rows, labels] = await Promise.all([
    BacktestPosition.aggregate([
      { $match: { runId: run._id, status: "closed", address: { $in: addresses } } },
      {
        $group: {
          _id: { address: "$address", day: DAY_GROUP },
          pnlUsd: { $sum: "$realizedPnlUsd" },
          combinedPercent: { $sum: "$realizedPnlPercent" },
          trades: { $sum: 1 },
          wins: { $sum: { $cond: [{ $gt: ["$realizedPnlUsd", 0] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $lt: ["$realizedPnlUsd", 0] }, 1, 0] } },
        },
      },
    ]),
    BacktestAddress.find({ address: { $in: addresses } }, { address: 1, label: 1 }).lean(),
  ]);

  const days = [];
  for (let t = Date.parse(`${dayKey(run.windowStart)}T00:00:00Z`); t <= run.windowEnd.getTime(); t += DAY_MS) days.push(dayKey(t));

  const byAddress = {};
  for (const r of rows) {
    (byAddress[r._id.address] ??= {})[r._id.day] = { pnlUsd: r.pnlUsd, combinedPercent: r.combinedPercent, trades: r.trades, wins: r.wins, losses: r.losses };
  }
  const totalsByDay = {};
  for (const r of totalRows) totalsByDay[r._id] = { pnlUsd: r.pnlUsd, combinedPercent: r.combinedPercent, trades: r.trades, wins: r.wins, losses: r.losses };
  const through = {};
  for (const rt of runTraders) {
    through[rt.address] = rt.stage === "done" || rt.stage === "failed" || rt.stage === "skipped" ? null : rt.sim?.simulatedThrough ? dayKey(rt.sim.simulatedThrough) : "";
  }
  const labelBy = new Map(labels.map((l) => [l.address, l.label]));
  // `through[address]`: null = fully simulated; "" = nothing simulated yet; "YYYY-MM-DD" = days strictly before it are complete.
  return {
    days,
    byAddress,
    through,
    totalsByDay,
    allDone: unfinished === 0,
    rows: addresses.map((address) => ({ address, label: labelBy.get(address) || "" })),
    total,
    page: pageNo,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

const MAX_POINTS = 400;
const ACTIVE_EQUITY_TTL_MS = 5000;

/**
 * Cumulative realized P&L over time, as chart points (at most MAX_POINTS). The closed trades are cut into time-ordered buckets by the
 * database, so a run with hundreds of thousands of trades never has to be loaded into memory to be drawn.
 * @param {string} runId @param {{address?: string}} [opts]
 */
export async function getRunEquity(runId, { address } = {}) {
  const match = { runId: new mongoose.Types.ObjectId(String(runId)), status: "closed", closedAt: { $ne: null } };
  if (address) match.address = address;
  const compute = () =>
    BacktestPosition.aggregate(
      [
        { $match: match },
        { $bucketAuto: { groupBy: { $toLong: "$closedAt" }, buckets: MAX_POINTS, output: { pnlUsd: { $sum: "$realizedPnlUsd" }, n: { $sum: 1 } } } },
      ],
      { allowDiskUse: true, maxTimeMS: QUERY_LIMIT_MS }
    );
  // The whole backtest's curve is a pass over every closed trade, so it is kept (longer, the slower it is); one address's is cheap.
  const buckets = address ? await compute() : await remembered(runId, "equity", ACTIVE_EQUITY_TTL_MS, compute);
  let cumulative = 0;
  let count = 0;
  const points = buckets.map((b) => {
    cumulative += b.pnlUsd || 0;
    count += b.n;
    return { t: new Date(b._id.max), cumulativeUsd: cumulative, n: count };
  });
  return { points };
}

/** Adds backtest addresses to the LIVE trader list (duplicate-protected, blacklisted ones are not revived). */
export async function promoteToLiveTraders(addresses, { listId } = {}) {
  const labels = await BacktestAddress.find({ address: { $in: addresses } }, { address: 1, label: 1 }).lean();
  const labelBy = new Map(labels.map((l) => [l.address, l.label || ""]));
  const result = await addTradersBulk(addresses.map((address) => ({ address, label: labelBy.get(address) || "" })));
  // Into a trader list as well, if one was chosen: the ones just added AND the ones already tracked (blacklisted ones are never touched).
  const tagged = listId ? await addTradersToList(listId, [...result.added, ...result.skipped]) : 0;
  return { ...result, tagged };
}
