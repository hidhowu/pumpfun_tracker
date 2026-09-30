import { Wallet } from "./models/Wallet.js";
import { WalletTrader } from "./models/WalletTrader.js";
import { WalletPosition } from "./models/WalletPosition.js";
import { WalletPendingExecution } from "./models/WalletPendingExecution.js";
import { WalletDailySnapshot } from "./models/WalletDailySnapshot.js";

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

/** Every wallet, lightweight summary for the /wallets list page. */
export async function listWallets() {
  const [wallets, traderCounts] = await Promise.all([
    Wallet.find({}).sort({ createdAt: -1 }).lean(),
    WalletTrader.aggregate([{ $group: { _id: "$walletId", count: { $sum: 1 } } }]),
  ]);
  const countByWallet = new Map(traderCounts.map((c) => [String(c._id), c.count]));
  return wallets.map((w) => ({ ...w, traderCount: countByWallet.get(String(w._id)) || 0 }));
}
