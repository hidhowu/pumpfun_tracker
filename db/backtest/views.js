import mongoose from "mongoose";
import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { BacktestView } from "../models/BacktestView.js";
import { computeTradeFees } from "../fees.js";
import { MAX_JITO_FEE_USD, MAX_PUMP_FEE_PERCENT } from "../settingsLimits.js";
import { buildCombinedLedger } from "./combined.js";

/**
 * Combined views: a finished (or partly finished) backtest is simulated ONCE - entries, exits and prices come from the pump.fun / RPC reads and are
 * stored per trade. A view takes some of its addresses and answers "what if this group had traded as one wallet with THIS trade amount, THESE fees and
 * THIS starting balance?" without touching the network: every stored trade is re-priced and the result is added up with the same shared-wallet ledger
 * a combined backtest uses (combined.js).
 *
 * Re-pricing a trade whose source size was S and which is now traded with N (k = N / S):
 *   - the token price path is unchanged, so the value of the position scales with k: proceeds' = proceeds * k  (an open trade: its marked value * k)
 *   - fees are charged again on the new amounts: buy fee' = N * pump% + jito, sell fee' = proceeds' * pump% + jito
 *   - realized P&L' = proceeds' - sell fee' - (N + buy fee')
 *
 * What stays as in the source run: which tokens were bought, when, and when/why each trade was sold. The exit rules (stop-loss, take-profit, trailing
 * stops) were judged on a P&L that included the source run's fees, so with much different fees a trade that sat right at a threshold could have exited a
 * moment earlier or later. For a fee change of this size (a fraction of a percent of price) that moves very few trades, and not the direction of the result.
 */

const MAX_VIEWS_PER_REQUEST = 200;
const MAX_ADDRESSES_PER_VIEW = 20_000;
const MAX_VIEWS_PER_RUN = 1000;

const POSITION_FIELDS = {
  address: 1,
  status: 1,
  openedAt: 1,
  closedAt: 1,
  costBasisUsd: 1,
  buyFeeUsd: 1,
  proceedsUsd: 1,
  sellFeeUsd: 1,
  realizedPnlUsd: 1,
  unrealizedPnlUsd: 1,
};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The numbers a view is priced with. Throws a readable Error for anything out of range. */
export function parseViewConfig(input, fallback = null) {
  const pick = (key, label, { min = 0, max, strictlyAbove = false }) => {
    const v = num(input?.[key] !== undefined ? Number(input[key]) : fallback?.[key]);
    if (v === null || v < min || v > max || (strictlyAbove && v <= min)) throw new Error(`${label} must be ${strictlyAbove ? "above" : "at least"} ${min} and at most ${max}`);
    return v;
  };
  return {
    startingBalanceUsd: pick("startingBalanceUsd", "Starting balance", { min: 0, max: 1_000_000_000, strictlyAbove: true }),
    tradeSizeUsd: pick("tradeSizeUsd", "Trade amount", { min: 0, max: 1_000_000_000, strictlyAbove: true }),
    pumpFeePercent: pick("pumpFeePercent", "Pump fee", { min: 0, max: MAX_PUMP_FEE_PERCENT }),
    jitoFeeUsd: pick("jitoFeeUsd", "Jito fee", { min: 0, max: MAX_JITO_FEE_USD }),
    resetDaily: typeof input?.resetDaily === "boolean" ? input.resetDaily : !!fallback?.resetDaily,
    allowNegativeBalance: typeof input?.allowNegativeBalance === "boolean" ? input.allowNegativeBalance : fallback?.allowNegativeBalance !== false,
  };
}

const configOf = (view) => ({
  startingBalanceUsd: view.startingBalanceUsd,
  tradeSizeUsd: view.tradeSizeUsd,
  pumpFeePercent: view.pumpFeePercent,
  jitoFeeUsd: view.jitoFeeUsd,
  resetDaily: !!view.resetDaily,
  allowNegativeBalance: view.allowNegativeBalance !== false,
});

/** What the source run was simulated with - the numbers a view is a "what if" against. */
export const sourceOf = (run) => ({
  tradeSizeUsd: run.settings?.tradeSizeUsd ?? null,
  pumpFeePercent: run.settings?.pumpFeePercent ?? null,
  jitoFeeUsd: run.settings?.jitoFeeUsd ?? null,
});

/**
 * One stored position priced for the view's trade amount and fees. Returns null for a position that cannot be re-priced (no cost basis).
 * Keeps the fields buildCombinedLedger reads; `address` rides along for the per-address table.
 */
export function repricePosition(p, { tradeSizeUsd, pumpFeePercent, jitoFeeUsd }) {
  const sourceSize = p.costBasisUsd;
  if (!(sourceSize > 0)) return null;
  const k = tradeSizeUsd / sourceSize;
  const buyFeeUsd = computeTradeFees(tradeSizeUsd, { pumpFeePercent, jitoFeeUsd }).totalFeeUsd;
  const out = { address: p.address, status: p.status, openedAt: p.openedAt, closedAt: p.closedAt, costBasisUsd: tradeSizeUsd, buyFeeUsd };
  if (p.status === "closed") {
    const proceedsUsd = (p.proceedsUsd || 0) * k;
    const sellFeeUsd = computeTradeFees(proceedsUsd, { pumpFeePercent, jitoFeeUsd }).totalFeeUsd;
    return { ...out, proceedsUsd, sellFeeUsd, realizedPnlUsd: proceedsUsd - sellFeeUsd - tradeSizeUsd - buyFeeUsd };
  }
  // Open at the end of the window: the stored unrealized P&L is (value - cost - buy fee), so the marked value is recovered from it.
  const valueUsd = ((p.unrealizedPnlUsd || 0) + sourceSize + (p.buyFeeUsd || 0)) * k;
  return { ...out, proceedsUsd: 0, sellFeeUsd: 0, realizedPnlUsd: 0, unrealizedPnlUsd: valueUsd - tradeSizeUsd - buyFeeUsd };
}

/** Re-prices every position and adds them up per address. */
function repriceAll(positions, cfg) {
  const priced = [];
  const perAddress = new Map();
  let feesUsd = 0;
  for (const p of positions) {
    const q = repricePosition(p, cfg);
    if (!q) continue;
    priced.push(q);
    const a = perAddress.get(q.address) ?? { address: q.address, trades: 0, wins: 0, losses: 0, open: 0, pnlUsd: 0, feesUsd: 0 };
    if (q.status === "closed") {
      a.trades += 1;
      a.pnlUsd += q.realizedPnlUsd;
      if (q.realizedPnlUsd > 0) a.wins += 1;
      else if (q.realizedPnlUsd < 0) a.losses += 1;
      a.feesUsd += q.buyFeeUsd + q.sellFeeUsd;
      feesUsd += q.buyFeeUsd + q.sellFeeUsd;
    } else {
      a.open += 1;
      a.feesUsd += q.buyFeeUsd;
      feesUsd += q.buyFeeUsd;
    }
    perAddress.set(q.address, a);
  }
  return { priced, perAddress, feesUsd };
}

const ledgerOptions = (view, run) => ({
  startingUsd: view.startingBalanceUsd,
  resetDaily: !!view.resetDaily,
  allowNegativeBalance: view.allowNegativeBalance !== false,
  windowStart: run.windowStart,
  windowEnd: run.windowEnd,
});

const dto = (view) => ({
  _id: String(view._id),
  runId: String(view.runId),
  name: view.name,
  allAddresses: view.addresses.length === 0,
  addressCount: view.addresses.length,
  ...configOf(view),
  createdAt: view.createdAt,
});

/** Splits pasted text into addresses (any whitespace or comma), without duplicates. */
const cleanAddresses = (list) => [...new Set((Array.isArray(list) ? list : []).map((a) => String(a ?? "").trim()).filter(Boolean))];

async function assertAddressesInRun(runId, addresses, label) {
  if (addresses.length === 0) return;
  if (addresses.length > MAX_ADDRESSES_PER_VIEW) throw new Error(`${label}: at most ${MAX_ADDRESSES_PER_VIEW.toLocaleString()} addresses`);
  const found = new Set();
  for (let i = 0; i < addresses.length; i += 2000) {
    const rows = await BacktestRunTrader.find({ runId, address: { $in: addresses.slice(i, i + 2000) } }, { address: 1 }).lean();
    for (const r of rows) found.add(r.address);
  }
  const missing = addresses.filter((a) => !found.has(a));
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).map((a) => `${a.slice(0, 6)}…${a.slice(-4)}`).join(", ");
    throw new Error(`${label}: ${missing.length} address${missing.length === 1 ? " is" : "es are"} not in this backtest (${shown}${missing.length > 3 ? ", …" : ""})`);
  }
}

/**
 * Creates one or more views of a run that all share the same trade amount / fees / balance settings.
 * @param {string} runId
 * @param {{views: Array<{name?: string, addresses?: string[]}>, config: object}} input  a view with no addresses covers the whole run
 */
export async function createViews(runId, { views, config }) {
  const run = await BacktestRun.findById(runId, { _id: 1 }).lean();
  if (!run) throw new Error("Backtest not found");
  if (!Array.isArray(views) || views.length === 0) throw new Error("Nothing to create");
  if (views.length > MAX_VIEWS_PER_REQUEST) throw new Error(`At most ${MAX_VIEWS_PER_REQUEST} views at a time`);
  const cfg = parseViewConfig(config);
  const existing = await BacktestView.countDocuments({ runId });
  if (existing + views.length > MAX_VIEWS_PER_RUN) throw new Error(`A backtest can have at most ${MAX_VIEWS_PER_RUN} combined views`);

  const docs = [];
  for (const [i, v] of views.entries()) {
    const name = String(v?.name ?? "").trim().slice(0, 80) || `Combination ${existing + i + 1}`;
    const addresses = cleanAddresses(v?.addresses);
    await assertAddressesInRun(runId, addresses, `"${name}"`);
    docs.push({ runId, name, addresses, ...cfg });
  }
  const created = await BacktestView.insertMany(docs);
  return created.map((d) => dto(d));
}

/** Adds the positions of a run (only the given addresses, or all of them when `addresses` is null) to the Map by address. */
async function loadPositions(runId, addresses) {
  const filter = { runId: new mongoose.Types.ObjectId(String(runId)), status: { $in: ["closed", "open"] } };
  if (addresses) filter.address = { $in: addresses };
  const rows = await BacktestPosition.find(filter, POSITION_FIELDS).lean();
  const byAddress = new Map();
  for (const p of rows) {
    if (!byAddress.has(p.address)) byAddress.set(p.address, []);
    byAddress.get(p.address).push(p);
  }
  return byAddress;
}

const positionsOf = (view, byAddress) => {
  if (view.addresses.length === 0) return [...byAddress.values()].flat();
  return view.addresses.flatMap((a) => byAddress.get(a) ?? []);
};

/** The headline numbers of a view, for the list. */
function summarise(ledger, feesUsd) {
  const w = ledger.wallet;
  return {
    realizedPnlUsd: w.realizedPnlUsd,
    returnPercent: w.startingUsd > 0 ? (w.realizedPnlUsd / w.startingUsd) * 100 : 0,
    balanceUsd: w.balanceUsd,
    lowestBalanceUsd: w.lowestBalanceUsd,
    closedPositionCount: w.closedPositionCount,
    openPositionCount: w.openPositionCount,
    winRatePercent: w.winRatePercent,
    lossDays: w.lossDays,
    profitDays: w.profitDays,
    negativeBalanceEventCount: w.negativeBalanceEventCount,
    testedStartDays: w.testedStartDays,
    lostCapitalDays: w.lostCapitalDays,
    feesUsd,
  };
}

/** Every view of a run with its headline numbers. The run's trades are read once, however many views there are. */
export async function listViews(runId) {
  const run = await BacktestRun.findById(runId, { addresses: 0 }).lean();
  if (!run) return undefined;
  const views = await BacktestView.find({ runId }).sort({ createdAt: 1, _id: 1 }).lean();
  const all = views.some((v) => v.addresses.length === 0);
  const wanted = all ? null : [...new Set(views.flatMap((v) => v.addresses))];
  const byAddress = views.length === 0 ? new Map() : await loadPositions(runId, wanted);
  return {
    source: sourceOf(run),
    views: views.map((v) => {
      const { priced, feesUsd } = repriceAll(positionsOf(v, byAddress), configOf(v));
      return { ...dto(v), summary: summarise(buildCombinedLedger(priced, ledgerOptions(v, run)), feesUsd) };
    }),
  };
}

/** The shared wallet of one view, plus a row per address and any reason the numbers may be incomplete. */
export async function getViewWallet(runId, viewId) {
  if (!mongoose.isValidObjectId(viewId)) return undefined;
  const [run, view] = await Promise.all([BacktestRun.findById(runId, { addresses: 0 }).lean(), BacktestView.findOne({ _id: viewId, runId }).lean()]);
  if (!run || !view) return undefined;

  const scope = view.addresses.length > 0 ? { address: { $in: view.addresses } } : {};
  const [byAddress, unfinished, stopped, failed, skippedRows] = await Promise.all([
    loadPositions(runId, view.addresses.length > 0 ? view.addresses : null),
    BacktestRunTrader.countDocuments({ runId, ...scope, stage: { $in: ["pending", "collecting", "simulating"] } }),
    BacktestRunTrader.countDocuments({ runId, ...scope, stage: "skipped", stopReason: { $ne: null } }),
    BacktestRunTrader.countDocuments({ runId, ...scope, stage: "failed" }),
    BacktestRunTrader.aggregate([{ $match: { runId: run._id, ...scope } }, { $group: { _id: null, insufficient: { $sum: "$sim.skipped.insufficientBalance" } } }]),
  ]);

  const cfg = configOf(view);
  const { priced, perAddress, feesUsd } = repriceAll(positionsOf(view, byAddress), cfg);
  const ledger = buildCombinedLedger(priced, ledgerOptions(view, run));

  const addressList = view.addresses.length > 0 ? view.addresses : [...byAddress.keys()];
  const rows = addressList.map((address) => perAddress.get(address) ?? { address, trades: 0, wins: 0, losses: 0, open: 0, pnlUsd: 0, feesUsd: 0 });
  rows.sort((a, b) => b.pnlUsd - a.pnlUsd);

  const warnings = [];
  const insufficient = skippedRows[0]?.insufficient ?? 0;
  if (stopped > 0) warnings.push(`${stopped} address${stopped === 1 ? " was" : "es were"} dropped early as loss traders in the source backtest, so only their trades up to that point exist.`);
  if (failed > 0) warnings.push(`${failed} address${failed === 1 ? "" : "es"} failed in the source backtest and ${failed === 1 ? "has" : "have"} no trades here.`);
  if (insufficient > 0) warnings.push(`${insufficient.toLocaleString()} trade${insufficient === 1 ? "" : "s"} were never simulated in the source backtest because its own wallet could not pay for them, so they are missing here.`);
  const silent = rows.filter((r) => r.trades + r.open === 0).length;
  if (silent > 0 && unfinished === 0) warnings.push(`${silent} address${silent === 1 ? "" : "es"} of this view made no trades in the window.`);

  return {
    view: { ...dto(view), addresses: view.addresses }, // the addresses are only sent here (a list can hold thousands), for the edit dialog
    config: { ...cfg, tradeAmountUsd: cfg.tradeSizeUsd },
    ...ledger,
    complete: unfinished === 0 && run.status !== "queued",
    source: sourceOf(run),
    sourceStatus: run.status,
    feesUsd,
    perAddress: rows,
    warnings,
  };
}

/** Changes a view's name, addresses (an empty list = the whole run) and/or settings. */
export async function updateView(runId, viewId, patch) {
  if (!mongoose.isValidObjectId(viewId)) throw new Error("View not found");
  const view = await BacktestView.findOne({ _id: viewId, runId });
  if (!view) throw new Error("View not found");
  if (typeof patch.name === "string") {
    const name = patch.name.trim().slice(0, 80);
    if (!name) throw new Error("A view needs a name");
    view.name = name;
  }
  if (patch.addresses !== undefined) {
    const addresses = cleanAddresses(patch.addresses);
    await assertAddressesInRun(runId, addresses, `"${view.name}"`);
    view.addresses = addresses;
  }
  if (patch.config && typeof patch.config === "object") Object.assign(view, parseViewConfig(patch.config, configOf(view)));
  await view.save();
  return dto(view);
}

export async function deleteView(runId, viewId) {
  if (!mongoose.isValidObjectId(viewId)) throw new Error("View not found");
  const res = await BacktestView.deleteOne({ _id: viewId, runId });
  if (res.deletedCount === 0) throw new Error("View not found");
}

/** The addresses of `addresses` that are part of `runId`. */
async function addressesInRun(runId, addresses) {
  const found = new Set();
  for (let i = 0; i < addresses.length; i += 2000) {
    const rows = await BacktestRunTrader.find({ runId, address: { $in: addresses.slice(i, i + 2000) } }, { address: 1 }).lean();
    for (const r of rows) found.add(r.address);
  }
  return found;
}

/** Same name, same set of addresses and same settings - what makes an import of an already-imported view a no-op. */
const signature = (v) =>
  JSON.stringify([v.name, [...v.addresses].sort(), v.startingBalanceUsd, v.tradeSizeUsd, v.pumpFeePercent, v.jitoFeeUsd, !!v.resetDaily, v.allowNegativeBalance !== false]);

/**
 * The combined views of `sourceRunId`, each with how many of its addresses `targetRunId` also has - what the import dialog shows. A view of "every address"
 * of the source is always importable (it becomes "every address" of the target).
 */
export async function previewImport(targetRunId, sourceRunId) {
  const [target, source] = await Promise.all([BacktestRun.findById(targetRunId, { _id: 1 }).lean(), BacktestRun.findById(sourceRunId, { name: 1 }).lean()]);
  if (!target) throw new Error("Backtest not found");
  if (!source) throw new Error("The backtest to import from was not found");
  const views = await BacktestView.find({ runId: sourceRunId }).sort({ createdAt: 1, _id: 1 }).lean();
  const present = await addressesInRun(targetRunId, [...new Set(views.flatMap((v) => v.addresses))]);
  return {
    sourceName: source.name,
    views: views.map((v) => ({ ...dto(v), presentCount: v.addresses.filter((a) => present.has(a)).length })),
  };
}

/**
 * Copies views (name, addresses and settings - never trades) from another backtest onto this one, where they are worked out from THIS backtest's trades.
 * A view whose addresses are all in this backtest is copied as it is. One that is missing some is skipped, unless `allowPartial`: then it is copied with
 * the addresses that do exist (and skipped only when none do). A view identical to one already here is not copied twice.
 * @param {{viewIds?: string[], allowPartial?: boolean}} [opts]  viewIds = which views of the source (default: all of them)
 */
export async function importViews(targetRunId, sourceRunId, opts = {}) {
  const { viewIds, allowPartial = false } = opts;
  if (String(targetRunId) === String(sourceRunId)) throw new Error("Pick a different backtest to import from");
  const { views } = await previewImport(targetRunId, sourceRunId);
  const chosen = Array.isArray(viewIds) ? views.filter((v) => viewIds.includes(v._id)) : views;
  if (chosen.length === 0) throw new Error("Nothing to import");
  const sourceDocs = await BacktestView.find({ _id: { $in: chosen.map((v) => v._id) } }).lean();
  const here = await BacktestView.find({ runId: targetRunId }).lean();
  if (here.length + chosen.length > MAX_VIEWS_PER_RUN) throw new Error(`A backtest can have at most ${MAX_VIEWS_PER_RUN} combined views`);
  const have = new Set(here.map(signature));

  const docs = [];
  const skipped = [];
  let duplicates = 0;
  let partial = 0;
  const allAddresses = [...new Set(sourceDocs.flatMap((d) => d.addresses))];
  const present = await addressesInRun(targetRunId, allAddresses);
  for (const d of sourceDocs) {
    const keep = d.addresses.filter((a) => present.has(a));
    const missing = d.addresses.length - keep.length;
    if (d.addresses.length > 0 && keep.length === 0) {
      skipped.push({ name: d.name, reason: "none of its addresses are in this backtest" });
      continue;
    }
    if (missing > 0 && !allowPartial) {
      skipped.push({ name: d.name, reason: `${missing} of its ${d.addresses.length} addresses ${missing === 1 ? "is" : "are"} not in this backtest` });
      continue;
    }
    const doc = { runId: targetRunId, name: d.name, addresses: keep, startingBalanceUsd: d.startingBalanceUsd, tradeSizeUsd: d.tradeSizeUsd, pumpFeePercent: d.pumpFeePercent, jitoFeeUsd: d.jitoFeeUsd, resetDaily: !!d.resetDaily, allowNegativeBalance: d.allowNegativeBalance !== false };
    if (have.has(signature(doc))) {
      duplicates += 1;
      continue;
    }
    have.add(signature(doc));
    if (missing > 0) partial += 1;
    docs.push(doc);
  }
  const created = docs.length > 0 ? await BacktestView.insertMany(docs) : [];
  return { imported: created.map((c) => dto(c)), skipped, duplicates, partial };
}

/** A run is gone: so are its views. */
export const deleteViewsOfRun = (runId) => BacktestView.deleteMany({ runId });

/**
 * A run was merged into another one and removed. Views that name their addresses follow those addresses into the target (they are all there after the
 * merge); a view of "the whole run" would silently turn into "the whole other run", so those are dropped.
 */
export async function moveViewsToRun(fromRunId, toRunId) {
  await BacktestView.updateMany({ runId: fromRunId, "addresses.0": { $exists: true } }, { $set: { runId: toRunId } });
  await BacktestView.deleteMany({ runId: fromRunId });
}
