import { Wallet } from "./models/Wallet.js";
import { WalletTrader } from "./models/WalletTrader.js";
import { WalletPosition } from "./models/WalletPosition.js";
import { WalletPendingExecution } from "./models/WalletPendingExecution.js";
import { WalletDailySnapshot } from "./models/WalletDailySnapshot.js";
import { todayUtcString } from "./simulation/snapshot.js";

/** Creates a Wallet with its starting balance as both startingBalanceUsd (reference) and balanceUsd (current, spendable). */
export async function createWallet({ name, startingBalanceUsd, settings = {} }) {
  return Wallet.create({
    name,
    startingBalanceUsd,
    balanceUsd: startingBalanceUsd,
    settings,
  });
}

export async function renameWallet(id, name) {
  return Wallet.findByIdAndUpdate(id, { $set: { name } }, { returnDocument: "after" });
}

/** Body is a partial patch of Wallet.settings' fields - only provided keys are touched. */
export async function updateWalletSettings(id, patch) {
  const update = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) update[`settings.${key}`] = value;
  }
  return Wallet.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after" });
}

/** Deletes a wallet and every document scoped to it - mirrors db/profileService.js's deleteProfile cascade. */
export async function deleteWallet(id) {
  await Promise.all([
    WalletTrader.deleteMany({ walletId: id }),
    WalletPosition.deleteMany({ walletId: id }),
    WalletPendingExecution.deleteMany({ walletId: id }),
    WalletDailySnapshot.deleteMany({ walletId: id }),
  ]);
  await Wallet.deleteOne({ _id: id });
}

/** Bulk-assign: creates a WalletTrader row for every given address not already assigned (no-op for ones already there). */
export async function addTradersToWallet(walletId, addresses) {
  const existing = await WalletTrader.find({ walletId, traderAddress: { $in: addresses } }, { traderAddress: 1 }).lean();
  const existingAddresses = new Set(existing.map((d) => d.traderAddress));
  const toInsert = addresses.filter((a) => !existingAddresses.has(a));

  if (toInsert.length > 0) {
    await WalletTrader.insertMany(
      toInsert.map((traderAddress) => ({ walletId, traderAddress })),
      { ordered: false }
    );
  }
  return toInsert;
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
  await Promise.all([
    WalletPosition.deleteMany({ walletId: id }),
    WalletPendingExecution.deleteMany({ walletId: id }),
    WalletDailySnapshot.deleteMany({ walletId: id }),
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

  const wallet = await Wallet.create({
    name,
    startingBalanceUsd: copyTrades ? source.startingBalanceUsd : startingBalanceUsd,
    balanceUsd: copyTrades ? source.balanceUsd : startingBalanceUsd,
    realizedPnlUsd: copyTrades ? source.realizedPnlUsd : 0,
    openPositionCount: copyTrades ? source.openPositionCount : 0,
    closedPositionCount: copyTrades ? source.closedPositionCount : 0,
    settings: copySettings ? source.settings : {},
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
