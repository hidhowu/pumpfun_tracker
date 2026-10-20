import { LiveWallet } from "./models/LiveWallet.js";
import { Wallet } from "./models/Wallet.js";
import { Trader } from "./models/Trader.js";
import { addTradersBulk, isValidSolanaAddress } from "./traderService.js";
import { WalletTrader } from "./models/WalletTrader.js";
import { WalletPosition } from "./models/WalletPosition.js";
import { WalletPendingExecution } from "./models/WalletPendingExecution.js";
import { WalletDailySnapshot } from "./models/WalletDailySnapshot.js";
import { WalletHourlySnapshot } from "./models/WalletHourlySnapshot.js";
import { todayUtcString } from "./simulation/snapshot.js";
import { BacktestView } from "./models/BacktestView.js";
import { BacktestRunTrader } from "./models/BacktestRunTrader.js";
import { validateField, validateSettingsPatch, validateTrailingStops } from "./settingsLimits.js";
import { assertWalletSimulation, isLive, LiveModeError } from "./mode.js";

/** Creates a Wallet with its starting balance as both startingBalanceUsd (reference) and balanceUsd (current, spendable). */
export async function createWallet({ name, startingBalanceUsd, settings = {} }) {
  const balance = validateField("startingBalanceUsd", startingBalanceUsd);
  if (!balance.ok || !(startingBalanceUsd > 0)) throw new Error("startingBalanceUsd must be a positive number within range");
  const clean = validateWalletSettings(settings);
  return Wallet.create({
    name,
    startingBalanceUsd,
    balanceUsd: startingBalanceUsd,
    settings: clean,
    lastAutoResetDate: todayUtcString(), // starts with a full balance - first auto reset (if enabled) is tomorrow
  });
}

export async function renameWallet(id, name) {
  return Wallet.findByIdAndUpdate(id, { $set: { name } }, { returnDocument: "after" });
}

// Every settable Wallet.settings field and how to validate it (ranges live in db/settingsLimits.js) - anything
// else in a patch is ignored rather than written blindly into the document.
const NUMBER_FIELDS = [
  "tradeSizeUsd",
  "dustBuyUsd",
  "dustSellFractionPercent",
  "maxTradeTimeSeconds",
  "executionDelaySeconds",
  "pumpFeePercent",
  "jitoFeeUsd",
];
// null = disabled
const NULLABLE_NUMBER_FIELDS = ["stopLossPercent", "takeProfitPercent"];
const BOOLEAN_FIELDS = ["autoResetBalanceDaily"];
export const TRACKING_METHODS = ["logs", "api"];

/** Validates a settings object (or partial patch) and returns only the accepted keys. THROWS an Error naming the first bad setting - callers turn that into a 400. */
export function validateWalletSettings(patch) {
  const checked = validateSettingsPatch(patch, [...NUMBER_FIELDS, ...NULLABLE_NUMBER_FIELDS], { nullable: NULLABLE_NUMBER_FIELDS });
  if (!checked.ok) throw new Error(checked.error);
  const out = { ...checked.values };
  for (const key of BOOLEAN_FIELDS) {
    if (key in patch && patch[key] !== undefined) {
      if (typeof patch[key] !== "boolean") throw new Error(`${key} must be true or false`);
      out[key] = patch[key];
    }
  }
  if ("trackingMethod" in patch && patch.trackingMethod !== undefined) {
    if (!TRACKING_METHODS.includes(patch.trackingMethod)) throw new Error(`trackingMethod must be one of: ${TRACKING_METHODS.join(", ")}`);
    out.trackingMethod = patch.trackingMethod;
  }
  if ("trailingStops" in patch) {
    const rules = validateTrailingStops(patch.trailingStops);
    if (!rules.ok) throw new Error(rules.error);
    out.trailingStops = rules.value;
  }
  return out;
}

/** Body is a partial patch of Wallet.settings' fields - only provided, valid keys are touched; an invalid value throws (see validateWalletSettings). */
export async function updateWalletSettings(id, patch) {
  const clean = validateWalletSettings(patch);
  const update = {};
  for (const [key, value] of Object.entries(clean)) update[`settings.${key}`] = value;

  // Turning the daily reset ON shouldn't wipe today's balance mid-day: mark
  // today as already handled, so the first automatic reset is the next
  // day boundary. Turning it OFF clears the marker.
  if (patch.autoResetBalanceDaily === true) {
    await assertWalletSimulation(id, "The daily balance reset");
    const current = await Wallet.findById(id, { "settings.autoResetBalanceDaily": 1 }).lean();
    if (current && !current.settings?.autoResetBalanceDaily) update.lastAutoResetDate = todayUtcString();
  } else if (patch.autoResetBalanceDaily === false) {
    update.lastAutoResetDate = null;
  }

  if (Object.keys(update).length === 0) return Wallet.findById(id);
  return Wallet.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after" });
}

/** Deletes a wallet and every document scoped to it - mirrors db/profileService.js's deleteProfile cascade. */
export async function deleteWallet(id) {
  await assertWalletSimulation(id, "Deleting a wallet");
  await Promise.all([
    WalletTrader.deleteMany({ walletId: id }),
    WalletPosition.deleteMany({ walletId: id }),
    WalletPendingExecution.deleteMany({ walletId: id }),
    WalletDailySnapshot.deleteMany({ walletId: id }),
    WalletHourlySnapshot.deleteMany({ walletId: id }),
  ]);
  await Wallet.deleteOne({ _id: id });
}

/**
 * Bulk-assign traders to a wallet. Only ACTIVE tracked traders are ever
 * assigned - a blacklisted (or untracked) address is skipped, never
 * assigned. With `trackNew`, addresses not on the platform at all are first
 * added as tracked traders (via addTradersBulk - which itself never
 * re-activates a blacklisted address) and then assigned; without it they're
 * reported as `untracked`.
 *
 * Returns { added, alreadyInWallet, blacklisted, untracked, invalid, newlyTracked }.
 */
export async function addTradersToWallet(walletId, rawAddresses, { trackNew = false } = {}) {
  const addresses = [...new Set(rawAddresses.map((a) => (typeof a === "string" ? a.trim() : "")).filter(Boolean))];
  const invalid = addresses.filter((a) => !isValidSolanaAddress(a));
  const valid = addresses.filter((a) => isValidSolanaAddress(a));

  let newlyTracked = [];
  if (trackNew && valid.length > 0) {
    ({ added: newlyTracked } = await addTradersBulk(valid));
  }

  const traderDocs = await Trader.find({ address: { $in: valid } }, { address: 1, status: 1 }).lean();
  const statusByAddress = new Map(traderDocs.map((t) => [t.address, t.status]));
  const blacklisted = valid.filter((a) => statusByAddress.get(a) === "blacklisted");
  const untracked = valid.filter((a) => !statusByAddress.has(a));
  const active = valid.filter((a) => statusByAddress.get(a) === "active");

  const existing = await WalletTrader.find({ walletId, traderAddress: { $in: active } }, { traderAddress: 1 }).lean();
  const existingAddresses = new Set(existing.map((d) => d.traderAddress));
  const alreadyInWallet = active.filter((a) => existingAddresses.has(a));
  const toInsert = active.filter((a) => !existingAddresses.has(a));

  if (toInsert.length > 0) {
    await WalletTrader.insertMany(
      toInsert.map((traderAddress) => ({ walletId, traderAddress })),
      { ordered: false }
    ).catch((err) => {
      if (err?.code !== 11000 && !err?.writeErrors) throw err; // concurrent duplicate assign - harmless
    });
  }
  return { added: toInsert, alreadyInWallet, blacklisted, untracked, invalid, newlyTracked };
}

/** Un-assigns traders from a wallet. Any of their currently-open WalletPositions are left as-is (still tracked/closeable normally) - removal only stops NEW trades from being queued for them going forward. */
export async function removeTradersFromWallet(walletId, addresses) {
  const result = await WalletTrader.deleteMany({ walletId, traderAddress: { $in: addresses } });
  return result.deletedCount || 0;
}

/**
 * Full simulation reset for one wallet: wipes every open/closed position,
 * pending execution, and daily snapshot, resets the wallet's own balance/P&L
 * back to its starting balance, and resets every assigned trader's per-wallet
 * stats (everBoughtMints/position counts/realizedPnlUsd/lastActionAt) back to
 * zero - as if this wallet had just been created fresh. Deliberately does
 * NOT touch `settings` (the wallet's trade-size/fee/stop-loss/etc config) or
 * the WalletTrader rows themselves (the trader assignments stay exactly as
 * they were) - only trade history and the numbers derived from it are wiped.
 */
export async function resetWallet(id) {
  await assertWalletSimulation(id, "Resetting a wallet");
  await Promise.all([
    WalletPosition.deleteMany({ walletId: id }),
    WalletPendingExecution.deleteMany({ walletId: id }),
    WalletDailySnapshot.deleteMany({ walletId: id }),
    // Hourly snapshots are deliberately kept - only deleting the wallet removes them.
    WalletTrader.updateMany(
      { walletId: id },
      { $set: { everBoughtMints: [], openPositionCount: 0, closedPositionCount: 0, realizedPnlUsd: 0, lastActionAt: null } }
    ),
  ]);

  const wallet = await Wallet.findById(id);
  if (!wallet) return null;
  return Wallet.findOneAndUpdate(
    { _id: id },
    {
      $set: {
        balanceUsd: wallet.startingBalanceUsd,
        realizedPnlUsd: 0,
        openPositionCount: 0,
        closedPositionCount: 0,
      },
    },
    { returnDocument: "after" }
  );
}

/**
 * Balance-only reset: sets balanceUsd back to startingBalanceUsd and nothing
 * else - every position (open or closed), pending execution, daily snapshot,
 * and every assigned trader's stats are left completely untouched, as is
 * realizedPnlUsd (that's cumulative historical P&L, not "current spendable
 * cash"). This is the non-destructive counterpart to resetWallet above: for
 * "give me fresh capital to test with" without losing the trade-history
 * record of what already happened. Same operation applyDailyBalanceResets
 * runs automatically - see that function for the daily-cron version.
 */
export async function resetWalletBalance(id) {
  const wallet = await Wallet.findById(id);
  if (!wallet) return null;
  if (isLive(wallet)) throw new LiveModeError("Resetting a wallet balance");
  return Wallet.findOneAndUpdate(
    { _id: id },
    { $set: { balanceUsd: wallet.startingBalanceUsd } },
    { returnDocument: "after" }
  );
}

/** Copies every field of a lean document except _id/__v/walletId, for re-inserting under a new walletId - mirrors db/profileService.js's identical helper for Profile cloning. */
function stripDocMeta(doc) {
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, walletId, ...rest } = doc;
  return rest;
}

/**
 * Duplicates a wallet into a brand-new one, with a new name and (normally)
 * its own starting balance. Three fully independent options control what
 * else gets copied from the source - pick any combination, or none:
 *
 *  - copySettings: copies the source's Wallet.settings as-is. Without it,
 *    the new wallet starts with the schema's built-in defaults.
 *  - copyTraders: re-creates a WalletTrader row for every trader currently
 *    assigned to the source - membership only, with fresh (zeroed) stats and
 *    a new addedAt, never the source's per-trader history (that describes
 *    trades the NEW wallet never actually made).
 *  - copyTrades: an exact fork of the source's current trade history AND
 *    the balance/P&L state that produced it - every open/closed
 *    WalletPosition, every still-pending WalletPendingExecution, every
 *    WalletDailySnapshot, plus the source's exact startingBalanceUsd/
 *    balanceUsd/realizedPnlUsd/position counts (this OVERRIDES whatever
 *    startingBalanceUsd was passed in - a snapshot of real trade history
 *    only makes sense paired with the exact balance it produced, same
 *    reasoning as db/profileService.js's Profile "clone" mode).
 */
export async function duplicateWallet(sourceId, { name, startingBalanceUsd, copySettings, copyTraders, copyTrades }) {
  const source = await Wallet.findById(sourceId).lean();
  if (!source) throw new Error("Source wallet not found");
  if (copyTrades) await assertWalletSimulation(sourceId, "Copying a wallet's trades");

  const wallet = await Wallet.create({
    name,
    startingBalanceUsd: copyTrades ? source.startingBalanceUsd : startingBalanceUsd,
    balanceUsd: copyTrades ? source.balanceUsd : startingBalanceUsd,
    realizedPnlUsd: copyTrades ? source.realizedPnlUsd : 0,
    openPositionCount: copyTrades ? source.openPositionCount : 0,
    closedPositionCount: copyTrades ? source.closedPositionCount : 0,
    settings: copySettings ? source.settings : {},
    // Same as turning the setting on (updateWalletSettings): the first
    // automatic reset is the next day boundary, not the next minute.
    lastAutoResetDate: todayUtcString(),
  });

  const tasks = [];

  if (copyTraders) {
    tasks.push(
      WalletTrader.find({ walletId: sourceId }, { traderAddress: 1 })
        .lean()
        .then((traders) =>
          traders.length > 0
            ? WalletTrader.insertMany(
                traders.map((t) => ({ walletId: wallet._id, traderAddress: t.traderAddress })),
                { ordered: false }
              )
            : null
        )
    );
  }

  if (copyTrades) {
    const insertIfAny = (Model, docs) =>
      docs.length > 0 ? Model.insertMany(docs.map((d) => ({ ...stripDocMeta(d), walletId: wallet._id }))) : null;

    tasks.push(
      WalletPosition.find({ walletId: sourceId })
        .lean()
        .then((docs) => insertIfAny(WalletPosition, docs)),
      WalletPendingExecution.find({ walletId: sourceId, status: { $in: ["pending", "processing"] } })
        .lean()
        .then((docs) => insertIfAny(WalletPendingExecution, docs)),
      WalletDailySnapshot.find({ walletId: sourceId })
        .lean()
        .then((docs) => insertIfAny(WalletDailySnapshot, docs))
    );
  }

  await Promise.all(tasks);
  return wallet;
}

/**
 * Every wallet, lightweight summary for the /wallets list page. Includes
 * each wallet's today's realized P&L (sum of realizedPnlUsd across
 * positions it closed today, UTC) alongside its lifetime realizedPnlUsd -
 * one aggregate query across every wallet at once, not one query per wallet.
 * This is a REALIZED number (same convention as realizedPnlUsd/"lifetime
 * P&L"), not a live mark-to-market value, so it needs no price lookups and
 * stays cheap regardless of how many wallets there are or how often this
 * list page polls. Particularly useful for a wallet with "reset balance
 * every day" on (db/simulation/walletSnapshot.js's applyDailyBalanceResets) -
 * its balance resets, but this keeps showing what it actually made today.
 */
export async function listWallets() {
  const today = todayUtcString();
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const [wallets, traderCounts, todayPnl] = await Promise.all([
    Wallet.find({}).sort({ createdAt: -1 }).lean(),
    WalletTrader.aggregate([{ $group: { _id: "$walletId", count: { $sum: 1 } } }]),
    WalletPosition.aggregate([
      { $match: { status: "closed", closedAt: { $gte: todayStart, $lt: todayEnd } } },
      { $group: { _id: "$walletId", combinedUsd: { $sum: "$realizedPnlUsd" } } },
    ]),
  ]);
  const countByWallet = new Map(traderCounts.map((c) => [String(c._id), c.count]));
  const todayPnlByWallet = new Map(todayPnl.map((p) => [String(p._id), p.combinedUsd]));
  return wallets.map((w) => ({
    ...w,
    traderCount: countByWallet.get(String(w._id)) || 0,
    todayRealizedPnlUsd: todayPnlByWallet.get(String(w._id)) || 0,
  }));
}

/**
 * Turns combined views of a backtest into live-tracking Wallets. Each view becomes one Wallet: its name, its addresses (as the wallet's traders - added
 * to tracking if not yet tracked, blacklisted ones skipped) and its settings (starting balance, trade amount, fees, daily reset). Nothing of the
 * backtest's trades is copied - the wallet starts clean from its starting balance and follows new trades only.
 *
 * With `settingsFromWalletId`, the exit/execution settings (stop-loss, take-profit, trailing stops, max trade time, delay, dust) are taken from that
 * existing wallet; the view's own balance, trade amount and fees are kept unless `useWalletMoneySettings` is true, which takes those from the wallet too.
 *
 * Returns { created: [{ walletId, name, viewId, addresses, added, blacklisted, invalid }], skipped: [{ viewId, name, reason }] }.
 */
export async function createWalletsFromBacktestViews(runId, { viewIds, settingsFromWalletId = null, useWalletMoneySettings = false }) {
  const views = await BacktestView.find({ runId, ...(viewIds?.length ? { _id: { $in: viewIds } } : {}) })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  if (views.length === 0) throw new Error("No combined views to add");

  let source = null;
  if (settingsFromWalletId) {
    source = await Wallet.findById(settingsFromWalletId).lean();
    if (!source) throw new Error("The wallet to import settings from was not found");
  }

  let wholeRun = null; // loaded once, only if a view covers the whole backtest
  const created = [];
  const skipped = [];
  for (const view of views) {
    let addresses = view.addresses;
    if (addresses.length === 0) {
      wholeRun ??= (await BacktestRunTrader.find({ runId }, { address: 1 }).lean()).map((t) => t.address);
      addresses = wholeRun;
    }
    if (addresses.length === 0) {
      skipped.push({ viewId: String(view._id), name: view.name, reason: "No addresses" });
      continue;
    }

    const own = {
      tradeSizeUsd: view.tradeSizeUsd,
      pumpFeePercent: view.pumpFeePercent,
      jitoFeeUsd: view.jitoFeeUsd,
      autoResetBalanceDaily: !!view.resetDaily,
    };
    let startingBalanceUsd = view.startingBalanceUsd;
    let settings = own;
    if (source) {
      const { autoResetBalanceDaily, tradeSizeUsd, pumpFeePercent, jitoFeeUsd, ...rest } = source.settings || {};
      settings = useWalletMoneySettings
        ? { ...rest, autoResetBalanceDaily, tradeSizeUsd, pumpFeePercent, jitoFeeUsd }
        : { ...rest, ...own };
      if (useWalletMoneySettings) startingBalanceUsd = source.startingBalanceUsd;
    }

    try {
      validateWalletSettings(settings);
      if (!(validateField("startingBalanceUsd", startingBalanceUsd).ok && startingBalanceUsd > 0)) throw new Error("starting balance is out of range");
    } catch (err) {
      skipped.push({ viewId: String(view._id), name: view.name, reason: err instanceof Error ? err.message : "Invalid settings" });
      continue;
    }
    const wallet = await createWallet({ name: view.name, startingBalanceUsd, settings });
    const result = await addTradersToWallet(wallet._id, addresses, { trackNew: true });
    created.push({
      walletId: String(wallet._id),
      name: wallet.name,
      viewId: String(view._id),
      addresses: addresses.length,
      added: result.added.length,
      blacklisted: result.blacklisted.length,
      invalid: result.invalid.length,
    });
  }
  return { created, skipped };
}
