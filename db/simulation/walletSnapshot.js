import { Wallet } from "../models/Wallet.js";
import { WalletPosition } from "../models/WalletPosition.js";
import { WalletDailySnapshot } from "../models/WalletDailySnapshot.js";
import { WalletHourlySnapshot } from "../models/WalletHourlySnapshot.js";
import { getPrice } from "../pumpFunApi.js";
import { todayUtcString } from "./snapshot.js"; // same UTC-date-string helper the trader side uses, no need to duplicate it
import { logEvent } from "../systemLog.js";

/** Wallet-scoped mirror of db/simulation/snapshot.js's currentPortfolioValueUsd: current balance + unrealized value of every open WalletPosition. */
export async function currentWalletValueUsd(walletId) {
  const [wallet, openPositions] = await Promise.all([
    Wallet.findById(walletId),
    WalletPosition.find({ walletId, status: "open" }),
  ]);
  if (!wallet) return 0;

  const unrealizedPerPosition = await Promise.all(
    openPositions.map(async (position) => {
      const price = await getPrice(position.mint);
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

/** "YYYY-MM-DDTHH" (UTC) - the key WalletHourlySnapshot rows are stored under. */
export function utcHourString(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

/**
 * Records (or refreshes) the current UTC hour's value reading for every
 * wallet - this is what gives the hourly chart its real, mark-to-market value
 * points. Runs on the same hourly maintenance tick as the daily snapshot (see
 * src/tracker.js), so each tick lands in its own hour. Hours before this
 * feature existed (or while the tracker was down) have no row; the chart falls
 * back to an estimate for those - see computeWalletHourlyBreakdown.
 */
export async function recordHourlyWalletSnapshots() {
  const hour = utcHourString();
  const wallets = await Wallet.find({}, { _id: 1 }).lean();
  for (const wallet of wallets) {
    const valueUsd = await currentWalletValueUsd(wallet._id);
    await WalletHourlySnapshot.updateOne(
      { walletId: wallet._id, hour },
      { $set: { valueUsd, recordedAt: new Date() } },
      { upsert: true }
    );
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
 * Cheap enough to call often (one indexed find that matches nothing on every
 * call but the first of the day) - the daemon checks every minute, and the
 * wallet API routes call it too, so a reset is never more than a minute
 * late and still happens even if the daemon is down or running stale code.
 *
 * Each wallet's reset is claimed atomically (lastAutoResetDate in the
 * filter), so the daemon and the web app racing on the same wallet can't
 * apply it twice. The day's baseline snapshot is re-based onto the
 * post-reset value (and the pre-reset value kept as the previous day's
 * close), so neither today's nor yesterday's P&L counts the injected
 * capital as profit.
 */
export async function applyDailyBalanceResets(date = todayUtcString()) {
  const candidates = await Wallet.find(
    { "settings.autoResetBalanceDaily": true, lastAutoResetDate: { $ne: date } },
    { _id: 1 }
  ).lean();

  let applied = 0;
  for (const { _id } of candidates) {
    // Valued before the claim below: once the balance flips, the pre-reset
    // value (needed as yesterday's close) is gone.
    const valueBeforeResetUsd = await currentWalletValueUsd(_id);

    const before = await Wallet.findOneAndUpdate(
      { _id, "settings.autoResetBalanceDaily": true, lastAutoResetDate: { $ne: date } },
      [{ $set: { balanceUsd: "$startingBalanceUsd", lastAutoResetDate: date, lastAutoResetAt: "$$NOW" } }],
      { returnDocument: "before", updatePipeline: true }
    ).lean();
    if (!before) continue; // claimed by a concurrent caller

    const deltaUsd = before.startingBalanceUsd - before.balanceUsd;
    const existing = await WalletDailySnapshot.findOne({ walletId: _id, date });
    if (existing) {
      await WalletDailySnapshot.updateOne(
        { _id: existing._id },
        {
          $inc: { portfolioValueUsdAtOpen: deltaUsd },
          $set: { valueBeforeResetUsd: existing.valueBeforeResetUsd ?? existing.portfolioValueUsdAtOpen },
        }
      );
    } else {
      await WalletDailySnapshot.create({
        walletId: _id,
        date,
        portfolioValueUsdAtOpen: valueBeforeResetUsd + deltaUsd,
        valueBeforeResetUsd,
      }).catch((err) => {
        if (err?.code !== 11000) throw err; // created concurrently - its value was taken post-reset already
      });
    }

    applied += 1;
    logEvent(
      "tracker",
      `Daily balance reset: wallet "${before.name}" $${before.balanceUsd.toFixed(2)} -> $${before.startingBalanceUsd.toFixed(2)}`,
      { meta: { walletId: String(_id), date, balanceBeforeUsd: before.balanceUsd, balanceAfterUsd: before.startingBalanceUsd } }
    );
  }
  return applied;
}
