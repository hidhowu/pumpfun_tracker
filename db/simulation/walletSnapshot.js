import { Wallet } from "../models/Wallet.js";
import { WalletPosition } from "../models/WalletPosition.js";
import { WalletDailySnapshot } from "../models/WalletDailySnapshot.js";
import { getCoinInfo, priceFromCoinInfo } from "../pumpFunApi.js";
import { todayUtcString } from "./snapshot.js"; // same UTC-date-string helper the trader side uses, no need to duplicate it

/** Wallet-scoped mirror of db/simulation/snapshot.js's currentPortfolioValueUsd: current balance + unrealized value of every open WalletPosition. */
export async function currentWalletValueUsd(walletId) {
  const [wallet, openPositions] = await Promise.all([
    Wallet.findById(walletId),
    WalletPosition.find({ walletId, status: "open" }),
  ]);
  if (!wallet) return 0;

  const unrealizedPerPosition = await Promise.all(
    openPositions.map(async (position) => {
      const coin = await getCoinInfo(position.mint).catch(() => null);
      const price = priceFromCoinInfo(coin);
      return price?.priceUsd ? position.tokenAmount * price.priceUsd : position.costBasisUsd;
    })
  );
  const unrealized = unrealizedPerPosition.reduce((sum, v) => sum + v, 0);
  return wallet.balanceUsd + unrealized;
}

/** Wallet-scoped mirror of ensureTodaySnapshot - self-healing "start of day" baseline for the performance chart. */
export async function ensureTodayWalletSnapshot(walletId, date = todayUtcString()) {
  const existing = await WalletDailySnapshot.findOne({ walletId, date });
  if (existing) return existing;

  const value = await currentWalletValueUsd(walletId);
  try {
    return await WalletDailySnapshot.create({ walletId, date, portfolioValueUsdAtOpen: value });
  } catch (err) {
    if (err?.code === 11000) return WalletDailySnapshot.findOne({ walletId, date }); // race - someone else just created it
    throw err;
  }
}

/** Runs ensureTodayWalletSnapshot for every wallet - call on daemon startup and roughly hourly. */
export async function ensureTodaySnapshotsForAllWallets() {
  const wallets = await Wallet.find({}, { _id: 1 }).lean();
  for (const wallet of wallets) {
    await ensureTodayWalletSnapshot(wallet._id);
  }
  return wallets.length;
}

/**
 * Applies the automatic "reset balance every day" wallet setting
 * (settings.autoResetBalanceDaily) - balanceUsd goes back to
 * startingBalanceUsd once per UTC day, same as the manual "Reset balance
 * only" action (resetWalletBalance in db/walletService.js); every
 * open/closed position, trade history, and realizedPnlUsd is left
 * completely untouched - this is "fresh capital to test with every day",
 * not a trade-history wipe.
 *
 * lastAutoResetDate guards against re-applying this on every hourly check
 * within the same UTC day. MUST be called before
 * ensureTodaySnapshotsForAllWallets in the same tick (see src/tracker.js) -
 * the whole point is that the day's baseline snapshot (which the daily P&L
 * chart measures "today's performance" against) captures the balance AFTER
 * this reset, not before it.
 */
export async function applyDailyBalanceResets(date = todayUtcString()) {
  const wallets = await Wallet.find(
    { "settings.autoResetBalanceDaily": true, lastAutoResetDate: { $ne: date } },
    { _id: 1, startingBalanceUsd: 1 }
  ).lean();

  for (const wallet of wallets) {
    await Wallet.updateOne(
      { _id: wallet._id },
      { $set: { balanceUsd: wallet.startingBalanceUsd, lastAutoResetDate: date } }
    );
  }
  return wallets.length;
}
