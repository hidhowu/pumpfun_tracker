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
