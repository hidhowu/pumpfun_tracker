import { Trader } from "../models/Trader.js";
import { Wallet } from "../models/Wallet.js";
import { WalletTrader } from "../models/WalletTrader.js";
import { WalletPosition } from "../models/WalletPosition.js";
import { WalletPendingExecution } from "../models/WalletPendingExecution.js";
import { getCoinInfo, priceFromCoinInfo } from "../pumpFunApi.js";
import { logEvent } from "../systemLog.js";

async function markSkipped(pending, reason) {
  pending.status = "skipped";
  pending.skipReason = reason;
  pending.processedAt = new Date();
  await pending.save();
  logEvent("trade", `Skipped wallet ${pending.action} of ${pending.mint} for ${pending.traderAddress} (wallet ${pending.walletId}): ${reason}`, {
    level: "warn",
    meta: { walletId: String(pending.walletId), traderAddress: pending.traderAddress, mint: pending.mint, action: pending.action, reason },
  });
}

async function markDone(pending) {
  pending.status = "done";
  pending.processedAt = new Date();
  await pending.save();
}

function computeUnrealized(currentValueUsd, totalCost) {
  const unrealizedUsd = currentValueUsd - totalCost;
  const unrealizedPercent = totalCost > 0 ? (unrealizedUsd / totalCost) * 100 : 0;
  return { unrealizedUsd, unrealizedPercent };
}

/**
 * Wallet-scoped mirror of db/simulation/executor.js's executeBuy, with one
 * structural difference: the wallet's balance can NEVER go negative. That
 * cap is enforced with an atomic conditional decrement -
 * `findOneAndUpdate({balanceUsd: {$gte: totalCost}}, {$inc: {balanceUsd: -totalCost}})`
 * - not a plain read-then-check-then-write, for the exact race-safety
 * reason db/simulation/executor.js's closePosition already documents in
 * this codebase (two concurrent claims could both read a stale balance and
 * both proceed). A null result means insufficient balance right now, so
 * this trade is silently skipped for THIS wallet only - it never touches
 * the trader's own per-Profile simulation, a completely separate
 * collection/balance.
 */
async function executeWalletBuy(pending) {
  const trader = await Trader.findOne({ address: pending.traderAddress });
  if (!trader || trader.status !== "active") return markSkipped(pending, "trader inactive or blacklisted");

  const walletTrader = await WalletTrader.findOne({ walletId: pending.walletId, traderAddress: pending.traderAddress });
  if (!walletTrader) return markSkipped(pending, "trader no longer assigned to this wallet (race)");
  if (walletTrader.everBoughtMints.includes(pending.mint)) return markSkipped(pending, "already bought this mint on this wallet (race)");

  const existingOpen = await WalletPosition.exists({ walletId: pending.walletId, traderAddress: trader.address, mint: pending.mint, status: "open" });
  if (existingOpen) return markSkipped(pending, "position already open on this wallet (race)");

  const walletDoc = await Wallet.findById(pending.walletId);
  if (!walletDoc) return markSkipped(pending, "wallet no longer exists");

  const coin = await getCoinInfo(pending.mint).catch(() => null);
  const price = priceFromCoinInfo(coin);
  if (!price?.priceUsd) return markSkipped(pending, "no current price available for this mint");

  const spendUsd = walletDoc.settings.tradeSizeUsd;
  const feeUsd = walletDoc.settings.feeUsd;
  const totalCost = spendUsd + feeUsd;

  const debited = await Wallet.findOneAndUpdate(
    { _id: pending.walletId, balanceUsd: { $gte: totalCost } },
    { $inc: { balanceUsd: -totalCost } },
    { returnDocument: "after" }
  );
  if (!debited) return markSkipped(pending, "insufficient wallet balance");

  const tokenAmount = spendUsd / price.priceUsd;
  const initialUnrealized = computeUnrealized(spendUsd, totalCost);

  try {
    await WalletPosition.create({
      walletId: pending.walletId,
      traderAddress: trader.address,
      mint: pending.mint,
      status: "open",
      tokenAmount,
      costBasisUsd: spendUsd,
      buyFeeUsd: feeUsd,
      buyPriceUsd: price.priceUsd,
      openTriggerSignature: pending.sourceSignature,
      maxValueUsd: spendUsd,
      maxUnrealizedPnlUsd: initialUnrealized.unrealizedUsd,
      maxUnrealizedPnlPercent: initialUnrealized.unrealizedPercent,
      minValueUsd: spendUsd,
      minUnrealizedPnlUsd: initialUnrealized.unrealizedUsd,
      minUnrealizedPnlPercent: initialUnrealized.unrealizedPercent,
    });
  } catch (err) {
    // The balance was already debited above - if creating the position
    // failed (e.g. lost a race on the unique-open-position index), refund
    // it, since this buy never actually happened for the wallet.
    await Wallet.updateOne({ _id: pending.walletId }, { $inc: { balanceUsd: totalCost } });
    if (err?.code === 11000) return markSkipped(pending, "position already open on this wallet (lost the race)");
    throw err;
  }

  await WalletTrader.updateOne(
    { _id: walletTrader._id },
    { $inc: { openPositionCount: 1 }, $addToSet: { everBoughtMints: pending.mint }, $set: { lastActionAt: new Date() } }
  );
  await Wallet.updateOne({ _id: pending.walletId }, { $inc: { openPositionCount: 1 } });

  await markDone(pending);
  logEvent("trade", `[wallet] Bought ${pending.mint} for ${trader.address}: $${spendUsd.toFixed(2)} @ $${price.priceUsd}`, {
    meta: { walletId: String(pending.walletId), traderAddress: trader.address, mint: pending.mint, spendUsd, priceUsd: price.priceUsd },
  });
}

/** Wallet-scoped mirror of db/simulation/executor.js's closePosition - see that function's comment for why findOneAndUpdate with a status guard (not read-then-write) is the actual concurrency guarantee here too. */
async function closeWalletPosition(positionId, { priceUsd, feeUsd, closeReason, closeSignature }) {
  const position = await WalletPosition.findOne({ _id: positionId, status: "open" });
  if (!position) return null;

  const proceedsUsd = position.tokenAmount * priceUsd;
  const totalCost = position.costBasisUsd + position.buyFeeUsd;
  const netProceeds = proceedsUsd - feeUsd;
  const realizedPnlUsd = netProceeds - totalCost;
  const realizedPnlPercent = totalCost > 0 ? (realizedPnlUsd / totalCost) * 100 : 0;

  const closeUnrealized = computeUnrealized(proceedsUsd, totalCost);
  const peakIsNow = proceedsUsd > position.maxValueUsd;
  const troughIsNow = position.minValueUsd === null || proceedsUsd < position.minValueUsd;

  const updated = await WalletPosition.findOneAndUpdate(
    { _id: positionId, status: "open" },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        closeReason,
        closeTriggerSignature: closeSignature,
        sellPriceUsd: priceUsd,
        proceedsUsd,
        sellFeeUsd: feeUsd,
        realizedPnlUsd,
        realizedPnlPercent,
        ...(peakIsNow
          ? { maxValueUsd: proceedsUsd, maxUnrealizedPnlUsd: closeUnrealized.unrealizedUsd, maxUnrealizedPnlPercent: closeUnrealized.unrealizedPercent }
          : {}),
        ...(troughIsNow
          ? { minValueUsd: proceedsUsd, minUnrealizedPnlUsd: closeUnrealized.unrealizedUsd, minUnrealizedPnlPercent: closeUnrealized.unrealizedPercent }
          : {}),
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) return null; // lost the race between the read above and this write

  // Sells only ever increase balance - a plain atomic $inc is sufficient
  // here (unlike the buy-side debit, there is no way this can push the
  // balance negative, so no conditional guard is needed).
  await Wallet.updateOne(
    { _id: updated.walletId },
    { $inc: { balanceUsd: netProceeds, realizedPnlUsd, closedPositionCount: 1, openPositionCount: -1 } }
  );
  await WalletTrader.updateOne(
    { walletId: updated.walletId, traderAddress: updated.traderAddress },
    { $inc: { openPositionCount: -1, closedPositionCount: 1, realizedPnlUsd }, $set: { lastActionAt: new Date() } }
  );

  logEvent(
    "trade",
    `[wallet] Closed ${updated.mint} for ${updated.traderAddress}: ${closeReason} pnl=$${realizedPnlUsd.toFixed(2)} (${realizedPnlPercent.toFixed(1)}%)`,
    { meta: { walletId: String(updated.walletId), traderAddress: updated.traderAddress, mint: updated.mint, closeReason, realizedPnlUsd, realizedPnlPercent } }
  );

  return updated;
}

async function executeWalletSell(pending) {
  const trader = await Trader.findOne({ address: pending.traderAddress });
  if (!trader) return markSkipped(pending, "trader not found");

  const position = await WalletPosition.findOne({
    walletId: pending.walletId,
    traderAddress: pending.traderAddress,
    mint: pending.mint,
    status: "open",
  });
  if (!position) return markSkipped(pending, "no open position on this wallet (race - already closed)");

  const walletDoc = await Wallet.findById(pending.walletId);
  if (!walletDoc) return markSkipped(pending, "wallet no longer exists");

  const coin = await getCoinInfo(pending.mint).catch(() => null);
  const price = priceFromCoinInfo(coin);
  if (!price?.priceUsd) return markSkipped(pending, "no current price available for this mint");

  await closeWalletPosition(position._id, {
    priceUsd: price.priceUsd,
    feeUsd: walletDoc.settings.feeUsd,
    closeReason: "trader_sell",
    closeSignature: pending.sourceSignature,
  });

  await markDone(pending);
}

/** Wallet-scoped mirror of processDuePendingExecutions - same atomic-claim pattern, own collection. */
export async function processDueWalletExecutions() {
  const due = await WalletPendingExecution.find({ status: "pending", triggerAt: { $lte: new Date() } }).limit(50);
  let processed = 0;
  for (const item of due) {
    const claimed = await WalletPendingExecution.findOneAndUpdate(
      { _id: item._id, status: "pending" },
      { $set: { status: "processing" } },
      { returnDocument: "after" }
    );
    if (!claimed) continue;
    try {
      if (claimed.action === "buy") await executeWalletBuy(claimed);
      else await executeWalletSell(claimed);
      processed += 1;
    } catch (err) {
      await markSkipped(claimed, err.message);
    }
  }
  return processed;
}

/**
 * Wallet-scoped mirror of checkRiskExits - same peak/lowest tracking +
 * stop-loss/take-profit/max-hold/trailing-stops logic, driven by each
 * position's OWN wallet's flat settings (no per-profile settings resolution
 * needed). Every position is checked concurrently, same reasoning as
 * checkRiskExits: a sequential sweep over many open positions can take far
 * longer than the configured check interval, and since this loop
 * self-reschedules only after the full sweep finishes, that silently
 * balloons the real gap between price samples - exactly how a genuine
 * intra-trade peak/dip gets missed between checks.
 */
export async function checkWalletRiskExits() {
  const openPositions = await WalletPosition.find({ status: "open" });
  const walletCache = new Map();

  const results = await Promise.all(
    openPositions.map(async (position) => {
      const walletKey = String(position.walletId);
      let wallet = walletCache.get(walletKey);
      if (wallet === undefined) {
        wallet = await Wallet.findById(position.walletId);
        walletCache.set(walletKey, wallet ?? null);
      }
      if (!wallet) return false;

      const coin = await getCoinInfo(position.mint).catch(() => null);
      const price = priceFromCoinInfo(coin);
      if (!price?.priceUsd) return false;

      const currentValue = position.tokenAmount * price.priceUsd;
      const totalCost = position.costBasisUsd + position.buyFeeUsd;
      const { unrealizedUsd, unrealizedPercent } = computeUnrealized(currentValue, totalCost);

      if (currentValue > position.maxValueUsd) {
        await WalletPosition.updateOne(
          { _id: position._id, status: "open" },
          { $set: { maxValueUsd: currentValue, maxUnrealizedPnlUsd: unrealizedUsd, maxUnrealizedPnlPercent: unrealizedPercent } }
        );
        position.maxValueUsd = currentValue;
      }
      if (position.minValueUsd === null || currentValue < position.minValueUsd) {
        await WalletPosition.updateOne(
          { _id: position._id, status: "open" },
          { $set: { minValueUsd: currentValue, minUnrealizedPnlUsd: unrealizedUsd, minUnrealizedPnlPercent: unrealizedPercent } }
        );
        position.minValueUsd = currentValue;
      }

      const settings = wallet.settings;
      const hasStopLoss = settings.stopLossPercent !== null && settings.stopLossPercent !== undefined;
      const hasTakeProfit = settings.takeProfitPercent !== null && settings.takeProfitPercent !== undefined;
      const hasMaxHoldTime = !!settings.maxTradeTimeSeconds && settings.maxTradeTimeSeconds > 0;
      const trailingStops = settings.trailingStops || [];
      if (!hasStopLoss && !hasTakeProfit && !hasMaxHoldTime && trailingStops.length === 0) return false;

      if (hasStopLoss && unrealizedPercent <= -Math.abs(settings.stopLossPercent)) {
        return !!(await closeWalletPosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "stop_loss", closeSignature: null }));
      }

      if (hasTakeProfit && unrealizedPercent >= Math.abs(settings.takeProfitPercent)) {
        return !!(await closeWalletPosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "take_profit", closeSignature: null }));
      }

      if (hasMaxHoldTime) {
        const elapsedSeconds = (Date.now() - position.openedAt.getTime()) / 1000;
        if (elapsedSeconds >= settings.maxTradeTimeSeconds) {
          return !!(await closeWalletPosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "max_hold_time", closeSignature: null }));
        }
      }

      if (trailingStops.length > 0) {
        const armedIds = new Set(position.armedTrailingStopIds.map(String));
        for (const rule of trailingStops) {
          const ruleId = String(rule._id);
          if (!armedIds.has(ruleId)) {
            if (unrealizedPercent >= rule.armPercent) {
              await WalletPosition.updateOne({ _id: position._id, status: "open" }, { $addToSet: { armedTrailingStopIds: ruleId } });
              logEvent(
                "trade",
                `[wallet] Trailing-stop armed on ${position.mint} for ${position.traderAddress} at +${unrealizedPercent.toFixed(1)}% (exits at ${rule.exitPercent}%)`,
                {
                  meta: {
                    walletId: String(position.walletId),
                    traderAddress: position.traderAddress,
                    mint: position.mint,
                    unrealizedPercent,
                    armPercent: rule.armPercent,
                    exitPercent: rule.exitPercent,
                  },
                }
              );
            }
          } else if (unrealizedPercent <= rule.exitPercent) {
            return !!(await closeWalletPosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "trailing_stop", closeSignature: null }));
          }
        }
      }
      return false;
    })
  );

  return results.filter(Boolean).length;
}
