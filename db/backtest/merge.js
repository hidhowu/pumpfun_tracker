import mongoose from "mongoose";
import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { freshAddressState } from "./rows.js";
import { invalidateRun } from "./runStats.js";
import { moveViewsToRun } from "./views.js";

/**
 * Merging backtests: the addresses of one or more SOURCE backtests are moved into a TARGET backtest, with their results, and the sources are
 * removed. Meant for backtests that were started separately but are really one test.
 *
 * What happens to an address's results depends on whether they were produced the way the target would produce them:
 *   - same simulation (same strategy settings, same number of days, same kind of backtest): the results move with the address and are kept;
 *   - different simulation (a different trade size, stop-loss, fees, delays, days...): kept results would mix two different strategies in one
 *     table, so the address is put back to "waiting" and the target simulates it again with its own settings (what was already collected from
 *     the chain is cached, so this is much faster than the first time). The caller can override this either way.
 * Rules that only decide which addresses are skipped or dropped (the signature limit, the loss-trader rules) or how fast things run (parallelism,
 * days at once, where trades are read from) never change a result, so they do not matter here; the target's rules apply from now on.
 * An address that is already in the target stays as it is there; the source's copy is dropped.
 *
 * It is done in steps (one page of the source's addresses per call, see mergeStep) so any size can be merged without one long request, and a step
 * can safely be repeated or the whole merge resumed after an interruption: rows that moved are simply no longer in the source.
 */

const PAGE = 5000;
const MAX_PAGE = 10_000;
const WORKING = ["queued", "running"];

/** Strategy fields that decide what a simulated trade looks like. A difference in any of these makes two sets of results incomparable. */
const SETTING_LABELS = {
  allocationUsd: "starting balance",
  tradeSizeUsd: "trade size",
  dustBuyUsd: "dust buy threshold",
  dustSellFractionPercent: "dust sell fraction",
  stopLossPercent: "stop-loss",
  takeProfitPercent: "take-profit",
  maxTradeTimeSeconds: "max hold time",
  trailingStops: "trailing stops",
  allowNegativeBalance: "allow negative balance",
  executionDelaySeconds: "execution delay",
  riskCheckIntervalSeconds: "risk check interval",
  fillLatencySeconds: "fill latency",
  pumpFeePercent: "pump.fun fee",
  jitoFeeUsd: "Jito fee",
};

const norm = (v) => (v === undefined ? null : v);
const trailing = (list) => JSON.stringify((list ?? []).map((r) => [r.armPercent, r.exitPercent]));
const show = (v) => (v == null ? "none" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

/** How the simulation of `source` differs from `target`'s: the differences that change results, and the ones that do not. */
export function compareRuns(target, source) {
  const differences = [];
  const add = (label, t, s) => differences.push({ label, target: show(t), source: show(s) });

  if (target.days !== source.days) add("days", target.days, source.days);
  const tMode = target.mode ?? "separate";
  const sMode = source.mode ?? "separate";
  if (tMode !== sMode) add("backtest style", tMode, sMode);
  for (const [key, label] of Object.entries(SETTING_LABELS)) {
    const t = target.settings?.[key];
    const s = source.settings?.[key];
    if (key === "trailingStops" ? trailing(t) !== trailing(s) : norm(t) !== norm(s)) add(label, key === "trailingStops" ? trailing(t) : t, key === "trailingStops" ? trailing(s) : s);
  }

  const other = [];
  const note = (label, t, s) => {
    if (JSON.stringify(norm(t)) !== JSON.stringify(norm(s))) other.push({ label, target: show(typeof t === "object" && t ? JSON.stringify(t) : t), source: show(typeof s === "object" && s ? JSON.stringify(s) : s) });
  };
  note("signature limit", target.maxSignatures || 0, source.maxSignatures || 0);
  note("loss-trader rules", target.earlyStop, source.earlyStop);
  note("trades read from", target.collectMethod ?? "api", source.collectMethod ?? "api");
  note("addresses at once", target.addressParallelism, source.addressParallelism);
  note("days at once", target.daysAtOnce || 0, source.daysAtOnce || 0);

  const offsetHours = Math.round(Math.abs(new Date(target.windowEnd).getTime() - new Date(source.windowEnd).getTime()) / 3_600_000);
  return { sameResults: differences.length === 0, differences, otherDifferences: other, windowOffsetHours: offsetHours };
}

const isWorking = (run) => WORKING.includes(run.status) && run.control === "run";

/**
 * What merging `sourceIds` into `targetId` would do, for the confirmation screen: for each source its size, whether it can be merged now, and how
 * its simulation differs from the target's (and so whether its addresses would be simulated again).
 */
export async function previewMerge(targetId, sourceIds) {
  const target = await BacktestRun.findById(targetId, { addresses: 0 }).lean();
  if (!target) throw new Error("The backtest to merge into was not found");
  const ids = [...new Set(sourceIds.map(String))].filter((id) => id !== String(target._id));
  if (ids.length === 0) throw new Error("Choose at least one other backtest to merge into it");
  const sources = await BacktestRun.find({ _id: { $in: ids } }, { addresses: 0 }).lean();
  if (sources.length !== ids.length) throw new Error("One of the backtests to merge was not found");
  const rowCounts = await BacktestRunTrader.aggregate([{ $match: { runId: { $in: sources.map((s) => s._id) } } }, { $group: { _id: "$runId", n: { $sum: 1 } } }]);
  const countBy = new Map(rowCounts.map((r) => [String(r._id), r.n]));
  return {
    target: { _id: String(target._id), name: target.name, status: target.status, days: target.days, addressCount: target.addressCount ?? 0, working: isWorking(target) },
    sources: sources.map((s) => {
      const cmp = compareRuns(target, s);
      return {
        _id: String(s._id),
        name: s.name,
        status: s.status,
        days: s.days,
        addressCount: countBy.get(String(s._id)) ?? 0,
        blocked: isWorking(s) ? "It is queued or running - pause it first" : null,
        sameResults: cmp.sameResults,
        differences: cmp.differences,
        otherDifferences: cmp.otherDifferences,
        windowOffsetHours: cmp.windowOffsetHours,
      };
    }),
  };
}

/**
 * Moves ONE PAGE of the source's addresses into the target. Pass the \`nextAfterId\` of the previous answer to continue (null = that was the last
 * page; call finishMerge next). \`rerun\`: put the moved addresses back to waiting and drop their results, so the target simulates them itself.
 * @param {string} targetId
 * @param {string} sourceId
 * @param {{afterId?: string|null, rerun?: boolean, limit?: number}} [opts]
 */
export async function mergeStep(targetId, sourceId, { afterId = null, rerun = false, limit = PAGE } = {}) {
  if (String(targetId) === String(sourceId)) throw new Error("A backtest cannot be merged into itself");
  const [target, source] = await Promise.all([
    BacktestRun.findById(targetId, { status: 1, control: 1 }).lean(),
    BacktestRun.findById(sourceId, { status: 1, control: 1 }).lean(),
  ]);
  if (!target) throw new Error("The backtest to merge into was not found");
  if (!source) throw new Error("The backtest being merged was not found");
  if (isWorking(source)) throw new Error("The backtest being merged is queued or running - pause it first");

  const size = Math.min(MAX_PAGE, Math.max(1, Math.floor(limit) || PAGE));
  const filter = { runId: source._id, ...(afterId ? { _id: { $gt: new mongoose.Types.ObjectId(String(afterId)) } } : {}) };
  const page = await BacktestRunTrader.find(filter, { address: 1, claimedBy: 1 }).sort({ _id: 1 }).limit(size).lean();
  if (page.some((r) => r.claimedBy)) throw new Error("An address of the backtest being merged is still being worked on - wait a few seconds after pausing it");

  const have = new Set((await BacktestRunTrader.find({ runId: target._id, address: { $in: page.map((r) => r.address) } }, { address: 1 }).lean()).map((r) => r.address));
  const movable = page.filter((r) => !have.has(r.address));

  if (movable.length > 0) {
    const ids = movable.map((r) => r._id);
    const addresses = movable.map((r) => r.address);
    if (rerun) {
      await BacktestPosition.deleteMany({ runId: source._id, address: { $in: addresses } });
      await BacktestRunTrader.updateMany({ _id: { $in: ids } }, { $set: { runId: target._id, ...freshAddressState() } });
    } else {
      await BacktestRunTrader.updateMany({ _id: { $in: ids } }, { $set: { runId: target._id } });
      await BacktestPosition.updateMany({ runId: source._id, address: { $in: addresses } }, { $set: { runId: target._id } });
    }
  }
  invalidateRun(target._id);
  invalidateRun(source._id);
  return { moved: movable.length, duplicates: page.length - movable.length, scanned: page.length, nextAfterId: page.length === size ? String(page.at(-1)._id) : null };
}

/**
 * The last step of merging one source: the target's address count is made exact, a finished target that now has addresses waiting is set to
 * paused (Resume works through just those), and the source - now holding only the duplicates it had in common with the target - is removed.
 */
export async function finishMerge(targetId, sourceId) {
  if (String(targetId) === String(sourceId)) throw new Error("A backtest cannot be merged into itself");
  const [target, source] = await Promise.all([BacktestRun.findById(targetId, { status: 1 }).lean(), BacktestRun.findById(sourceId, { status: 1, control: 1 }).lean()]);
  if (!target) throw new Error("The backtest to merge into was not found");
  if (!source) return { removedDuplicates: 0, targetAddressCount: await BacktestRunTrader.countDocuments({ runId: targetId }) }; // already finished
  if (isWorking(source)) throw new Error("The backtest being merged is queued or running - pause it first");

  // Safety: the source is deleted below, so every address still in it must already be in the target (it is only left holding duplicates).
  for (let after = null; ; ) {
    const rows = await BacktestRunTrader.find({ runId: source._id, ...(after ? { _id: { $gt: after } } : {}) }, { address: 1 }).sort({ _id: 1 }).limit(MAX_PAGE).lean();
    if (rows.length === 0) break;
    const inTarget = await BacktestRunTrader.countDocuments({ runId: target._id, address: { $in: rows.map((r) => r.address) } });
    if (inTarget !== rows.length) throw new Error("Not every address has been moved yet - run the merge for this backtest again");
    after = rows.at(-1)._id;
  }

  const [targetCount, waiting] = await Promise.all([
    BacktestRunTrader.countDocuments({ runId: target._id }),
    BacktestRunTrader.countDocuments({ runId: target._id, stage: { $in: ["pending", "collecting", "simulating"] } }),
  ]);
  // statsVersion 1: moved rows may predate newer stats, so the next view of the backtest writes them all again.
  await BacktestRun.updateOne({ _id: target._id }, { $set: { addressCount: targetCount, statsVersion: 1 } });
  if (waiting > 0) {
    await BacktestRun.updateOne({ _id: target._id, status: { $in: ["completed", "failed"] } }, { $set: { status: "paused", control: "pause", finishedAt: null, error: null } });
  }
  const leftover = await BacktestRunTrader.countDocuments({ runId: source._id });
  await Promise.all([BacktestPosition.deleteMany({ runId: source._id }), BacktestRunTrader.deleteMany({ runId: source._id })]);
  await moveViewsToRun(source._id, target._id);
  await BacktestRun.deleteOne({ _id: source._id });
  invalidateRun(target._id);
  invalidateRun(source._id);
  return { removedDuplicates: leftover, targetAddressCount: targetCount, waiting };
}
