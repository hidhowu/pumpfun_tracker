import mongoose from "mongoose";
import { Trader } from "../models/Trader.js";
import { Wallet } from "../models/Wallet.js";
import { WalletTrader } from "../models/WalletTrader.js";
import { WalletPosition } from "../models/WalletPosition.js";
import { WalletPendingExecution } from "../models/WalletPendingExecution.js";
import { getPrice, prefetchPrices, PRICE_MAX_AGE } from "../pumpFunApi.js";
import { logEvent } from "../systemLog.js";
import { computeTradeFees, DEFAULT_PUMP_FEE_PERCENT, realizedCounterDeltaOnClose } from "../fees.js";
import { applyOnce, wasApplied, savePlan, leaseExpiry, failOrRetry, reapStale } from "./atomic.js";
import { isTradingPaused } from "./guards.js";
import { mirrorExit } from "../live/trading/mirror.js";
import { TradeError } from "../live/trading/pumpSwap.js";
import { priceBuy, priceSell, valueMany } from "./sdkQuote.js";
import { tokenHasTrades } from "./apiClients.js";
import { CONFIRMED_EXITS, buildTrigger, confirmExit, recoveryLevel, triggerHolds } from "./exitTrigger.js";
import { INDEX_LAG_SEC, apiPlusIntervalSeconds, apiPlusSchedule, isApiPlusWallet, poolPriceAt } from "./apiPlus.js";

/** Wallets that follow their traders through pump.fun's API (Wallet.settings.trackingMethod) fill and are checked at SDK quotes, not spot prices. */
const isApiWallet = (wallet) => wallet?.settings?.trackingMethod === "api";

/**
 * The fee settings a fill is charged with. pump.fun takes its fee ON TOP of a buy, out of the wallet (the program puts budget / (1 + fee) into the
 * curve and keeps the rest), and OUT OF a sale's payout:
 *  - a BUY always pays the pump-fee percentage on top of the trade size, whatever priced it: an SDK quote is sized to put exactly the trade size into
 *    the curve (db/simulation/sdkQuote.js quoteBuy), a spot price has no fee in it;
 *  - a SELL quoted by the SDK already has the fee taken out of its payout, so the percentage is not charged again (only the Jito fee is added);
 *    a sale at a "spot" price (a token the SDK can't quote, or any logs-wallet fill) has no fee in it, so the setting applies as usual.
 */
const feeSettings = (wallet, method) => ({ pumpFeePercent: method === "sdk" ? 0 : wallet.settings.pumpFeePercent, jitoFeeUsd: wallet.settings.jitoFeeUsd });
const buyFeeSettings = (wallet) => ({ pumpFeePercent: wallet.settings.pumpFeePercent, jitoFeeUsd: wallet.settings.jitoFeeUsd });

async function markSkipped(pending, reason) {
  pending.status = "skipped";
  pending.skipReason = reason;
  pending.processedAt = new Date();
  pending.leaseUntil = null;
  await pending.save();
  logEvent("trade", `Skipped wallet ${pending.action} of ${pending.mint} for ${pending.traderAddress} (wallet ${pending.walletId}): ${reason}`, {
    level: "warn",
    meta: { walletId: String(pending.walletId), traderAddress: pending.traderAddress, mint: pending.mint, action: pending.action, reason },
  });
}

// A fill with no readable price (RPC hiccup, or the few seconds a token is
// migrating from its curve to its pool) is retried a little later instead of
// being dropped - dropping a SELL would leave the position open forever,
// since the trader's sell signal never comes again. Buys get fewer retries:
// a buy filled long after the signal isn't a faithful copy any more.
const MAX_PRICE_RETRIES = { buy: 2, sell: 5 };

async function retryWithoutPrice(pending) {
  if ((pending.attempts || 0) >= MAX_PRICE_RETRIES[pending.action]) {
    return markSkipped(pending, `no price available after ${pending.attempts + 1} attempts`);
  }
  pending.attempts = (pending.attempts || 0) + 1;
  pending.status = "pending";
  pending.leaseUntil = null;
  pending.triggerAt = new Date(Date.now() + 1000 * pending.attempts);
  await pending.save();
}

/** How long an "api_plus" fill waits for the trade list to show its price before it takes the best answer there is (buy / sell). */
const API_PLUS_MAX_WAIT_SEC = { buy: 25, sell: 60 };

/**
 * The pool price an "api_plus" fill takes (db/simulation/apiPlus.js): at the moment the fill was due, from the token's trade list. Not listed yet = the fill
 * is put back for a second without using a retry, until it has waited long enough; null then means there is no price at all (the caller retries/skips).
 * @returns {Promise<{ priceUsd: number, source: string } | "wait" | null>}
 */
async function apiPlusFillPrice(pending) {
  pending.priceAtSec ??= pending.triggerAt.getTime() / 1000;
  const waitedSec = Date.now() / 1000 - pending.priceAtSec;
  const force = waitedSec >= API_PLUS_MAX_WAIT_SEC[pending.action];
  const price = await poolPriceAt(pending.mint, pending.priceAtSec, { force });
  if (price) return { ...price, atSec: pending.priceAtSec };
  if (force) return null;
  pending.status = "pending";
  pending.leaseUntil = null;
  pending.triggerAt = new Date(Date.now() + 1000);
  await pending.save();
  return "wait";
}

async function markDone(pending) {
  pending.status = "done";
  pending.processedAt = new Date();
  pending.leaseUntil = null;
  await pending.save();
}

function computeUnrealized(currentValueUsd, totalCost) {
  const unrealizedUsd = currentValueUsd - totalCost;
  const unrealizedPercent = totalCost > 0 ? (unrealizedUsd / totalCost) * 100 : 0;
  return { unrealizedUsd, unrealizedPercent };
}

/**
 * Wallet-scoped mirror of db/simulation/executor.js's executeBuy. The wallet's balance can NEVER go negative: the debit is
 * an atomic conditional decrement (`balanceUsd >= totalCost` in the filter), not a read-then-check-then-write.
 *
 * The fill is crash-safe (see db/simulation/atomic.js): the plan - price, size, fees and the new position's id - is saved on
 * the queue entry first, then three idempotent steps run (debit + counter, create the position under the planned id,
 * update the trader's counters). If the process dies between steps, the entry is re-queued and the same plan finishes.
 * A null debit means insufficient balance right now, so this trade is skipped for THIS
 * wallet only - it never touches the trader's own per-Profile simulation, a completely separate collection/balance.
 */
async function executeWalletBuy(pending) {
  const walletDoc = await Wallet.findById(pending.walletId);
  if (!walletDoc) return markSkipped(pending, "wallet no longer exists");

  let fill = pending.fill;
  if (!fill) {
    // ---- decide whether to buy at all, and freeze the numbers. Nothing has moved yet.
    if (await isTradingPaused()) return markSkipped(pending, "trading is paused (kill switch)");

    const trader = await Trader.findOne({ address: pending.traderAddress });
    if (!trader || trader.status !== "active") return markSkipped(pending, "trader inactive or blacklisted");

    const walletTrader = await WalletTrader.findOne({ walletId: pending.walletId, traderAddress: pending.traderAddress });
    if (!walletTrader) return markSkipped(pending, "trader no longer assigned to this wallet (race)");
    if (walletTrader.everBoughtMints.includes(pending.mint)) return markSkipped(pending, "already bought this mint on this wallet (race)");

    const existingOpen = await WalletPosition.exists({ walletId: pending.walletId, traderAddress: trader.address, mint: pending.mint, status: "open" });
    if (existingOpen) return markSkipped(pending, "position already open on this wallet (race)");

    const spendUsd = walletDoc.settings.tradeSizeUsd;
    let priceUsd;
    let tokenAmount;
    let method = "spot";
    let apiPlus = null;
    if (isApiPlusWallet(walletDoc)) {
      // Same last check as an API wallet, then the fill is the pool price at the moment the buy was due - what the backtest fills at.
      if (!(await tokenHasTrades(pending.mint))) return markSkipped(pending, "no trades on this token (pump.fun's trades API returned none)");
      const price = await apiPlusFillPrice(pending);
      if (price === "wait") return;
      if (!price) return retryWithoutPrice(pending);
      priceUsd = price.priceUsd;
      tokenAmount = spendUsd / priceUsd;
      method = "api_plus";
      apiPlus = apiPlusSchedule({ mint: pending.mint, signature: pending.sourceSignature, fillAtSec: price.atSec, intervalSec: await apiPlusIntervalSeconds() });
    } else if (isApiWallet(walletDoc)) {
      // Last check before an API wallet buys: the token must have real trades on pump.fun. An empty answer skips the buy; a failed
      // request throws (and is retried) rather than being mistaken for an empty token.
      if (!(await tokenHasTrades(pending.mint))) return markSkipped(pending, "no trades on this token (pump.fun's trades API returned none)");
      // The fill is what pump.fun's SDK says buying the trade size's worth of tokens costs right now; its fee is booked on top, below.
      const quote = await priceBuy(pending.mint, spendUsd, { feePercent: walletDoc.settings.pumpFeePercent ?? DEFAULT_PUMP_FEE_PERCENT }).catch((err) => {
        if (err instanceof TradeError) return err;
        throw err;
      });
      if (quote instanceof TradeError) return markSkipped(pending, quote.message);
      if (!quote) return retryWithoutPrice(pending);
      ({ priceUsd, tokenAmount, method } = quote);
    } else {
      const price = await getPrice(pending.mint, { fresh: true });
      if (!price?.priceUsd) return retryWithoutPrice(pending);
      priceUsd = price.priceUsd;
      tokenAmount = spendUsd / priceUsd;
    }
    const buyFees = computeTradeFees(spendUsd, buyFeeSettings(walletDoc));
    const totalCost = spendUsd + buyFees.totalFeeUsd;

    fill = await savePlan(WalletPendingExecution, pending, {
      positionId: String(new mongoose.Types.ObjectId()),
      priceUsd,
      priceMethod: method,
      spendUsd,
      feeUsd: buyFees.totalFeeUsd,
      pumpFeeUsd: buyFees.pumpFeeUsd,
      jitoFeeUsd: buyFees.jitoFeeUsd,
      totalCost,
      tokenAmount,
      apiPlus,
    });
  }

  const { spendUsd, feeUsd, totalCost } = fill;
  const opKey = `buy:${pending._id}`;

  // ---- step 1: debit. The buy fee is booked into realized P&L right away, in the same write (see db/fees.js), and the
  // open-position counter moves with it. The filter makes the balance a hard limit.
  const debited = await applyOnce(
    Wallet,
    { _id: pending.walletId, balanceUsd: { $gte: totalCost } },
    opKey,
    { $inc: { balanceUsd: -totalCost, realizedPnlUsd: -feeUsd, openPositionCount: 1 } }
  );
  if (!debited && !(await wasApplied(Wallet, { _id: pending.walletId }, opKey))) {
    return markSkipped(pending, "insufficient wallet balance");
  }

  // ---- step 2: the position, under the id fixed in the plan (a repeat finds it already there).
  const initialUnrealized = computeUnrealized(spendUsd, totalCost);
  try {
    await WalletPosition.create({
      _id: fill.positionId,
      walletId: pending.walletId,
      traderAddress: pending.traderAddress,
      mint: pending.mint,
      status: "open",
      tokenAmount: fill.tokenAmount,
      costBasisUsd: spendUsd,
      buyFeeUsd: feeUsd,
      buyPumpFeeUsd: fill.pumpFeeUsd,
      buyJitoFeeUsd: fill.jitoFeeUsd,
      buyFeeRealizedAtOpen: true,
      buyPriceUsd: fill.priceUsd,
      apiPlus: fill.apiPlus ?? null,
      openTriggerSignature: pending.sourceSignature,
      maxValueUsd: spendUsd,
      maxUnrealizedPnlUsd: initialUnrealized.unrealizedUsd,
      maxUnrealizedPnlPercent: initialUnrealized.unrealizedPercent,
      minValueUsd: spendUsd,
      minUnrealizedPnlUsd: initialUnrealized.unrealizedUsd,
      minUnrealizedPnlPercent: initialUnrealized.unrealizedPercent,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    if (!err.keyPattern?._id) {
      // A DIFFERENT position is already open for this trader+mint (lost a race on the unique open-position index): this
      // buy never happened, so give the money back - once.
      await applyOnce(Wallet, { _id: pending.walletId }, `refund:${pending._id}`, {
        $inc: { balanceUsd: totalCost, realizedPnlUsd: feeUsd, openPositionCount: -1 },
      });
      return markSkipped(pending, "position already open on this wallet (lost the race)");
    }
    // else: our own position already exists - this is a resumed fill, carry on
  }

  // ---- step 3: the trader's counters. Guarded by "mint not yet recorded", so it applies once.
  await WalletTrader.updateOne(
    { walletId: pending.walletId, traderAddress: pending.traderAddress, everBoughtMints: { $ne: pending.mint } },
    {
      $inc: { openPositionCount: 1, realizedPnlUsd: -feeUsd },
      $addToSet: { everBoughtMints: pending.mint },
      $set: { lastActionAt: new Date() },
    }
  );

  await markDone(pending);
  logEvent("trade", `[wallet] Bought ${pending.mint} for ${pending.traderAddress}: $${spendUsd.toFixed(2)} + $${feeUsd.toFixed(2)} fees @ $${fill.priceUsd}`, {
    meta: { walletId: String(pending.walletId), traderAddress: pending.traderAddress, mint: pending.mint, spendUsd, feeUsd, priceUsd: fill.priceUsd },
  });
}

/**
 * Freezes the numbers of a close: what the position sells for at `priceUsd`, the fees, the realized P&L, and how it moves the
 * running counters. Stored on the position (pendingClose) before anything is paid out, so a resumed close books exactly this.
 */
function planClose(position, { priceUsd, fees, closeReason, closeSignature, pendingId, trigger = null }) {
  const proceedsUsd = position.tokenAmount * priceUsd;
  const sellFees = computeTradeFees(proceedsUsd, fees);
  const totalCost = position.costBasisUsd + position.buyFeeUsd;
  const netProceeds = proceedsUsd - sellFees.totalFeeUsd;
  const realizedPnlUsd = netProceeds - totalCost;
  const closeUnrealized = computeUnrealized(proceedsUsd, totalCost);
  return {
    pendingId: String(pendingId),
    closeReason,
    closeSignature,
    // What made this exit happen, with the price it actually filled at added (db/simulation/exitTrigger.js).
    trigger: trigger ? { ...trigger, fillPercent: closeUnrealized.unrealizedPercent, fillPriceUsd: priceUsd } : null,
    priceUsd,
    proceedsUsd,
    feeUsd: sellFees.totalFeeUsd,
    pumpFeeUsd: sellFees.pumpFeeUsd,
    jitoFeeUsd: sellFees.jitoFeeUsd,
    netProceeds,
    realizedPnlUsd,
    realizedPnlPercent: totalCost > 0 ? (realizedPnlUsd / totalCost) * 100 : 0,
    realizedDelta: realizedCounterDeltaOnClose(position, realizedPnlUsd),
    // The closing price is one more price sample for the peak/trough trackers.
    peak:
      proceedsUsd > position.maxValueUsd
        ? { maxValueUsd: proceedsUsd, maxUnrealizedPnlUsd: closeUnrealized.unrealizedUsd, maxUnrealizedPnlPercent: closeUnrealized.unrealizedPercent }
        : null,
    trough:
      position.minValueUsd === null || position.minValueUsd === undefined || proceedsUsd < position.minValueUsd
        ? { minValueUsd: proceedsUsd, minUnrealizedPnlUsd: closeUnrealized.unrealizedUsd, minUnrealizedPnlPercent: closeUnrealized.unrealizedPercent }
        : null,
  };
}

/**
 * Pays out a planned close in idempotent steps, flipping the position to "closed" LAST - so "closed" always means "fully
 * booked", and a position still "open" with a pendingClose plan is a close that can be resumed (executeWalletSell does).
 * Sells only increase the balance, so the credit needs no conditional guard.
 */
async function bookWalletClose(position, plan) {
  const opKey = `close:${position._id}`;
  await applyOnce(Wallet, { _id: position.walletId }, opKey, {
    $inc: { balanceUsd: plan.netProceeds, realizedPnlUsd: plan.realizedDelta, closedPositionCount: 1, openPositionCount: -1 },
  });
  await applyOnce(WalletTrader, { walletId: position.walletId, traderAddress: position.traderAddress }, opKey, {
    $inc: { openPositionCount: -1, closedPositionCount: 1, realizedPnlUsd: plan.realizedDelta },
    $set: { lastActionAt: new Date() },
  });

  const updated = await WalletPosition.findOneAndUpdate(
    { _id: position._id, status: "open" },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        closeReason: plan.closeReason,
        closeTriggerSignature: plan.closeSignature,
        closeTrigger: plan.trigger ?? null,
        sellPriceUsd: plan.priceUsd,
        proceedsUsd: plan.proceedsUsd,
        sellFeeUsd: plan.feeUsd,
        sellPumpFeeUsd: plan.pumpFeeUsd,
        sellJitoFeeUsd: plan.jitoFeeUsd,
        realizedPnlUsd: plan.realizedPnlUsd,
        realizedPnlPercent: plan.realizedPnlPercent,
        pendingClose: null,
        ...(plan.peak || {}),
        ...(plan.trough || {}),
      },
    },
    { returnDocument: "after" }
  );
  if (updated) {
    logEvent(
      "trade",
      `[wallet] Closed ${updated.mint} for ${updated.traderAddress}: ${plan.closeReason} pnl=$${plan.realizedPnlUsd.toFixed(2)} (${plan.realizedPnlPercent.toFixed(1)}%)`,
      {
        meta: {
          walletId: String(updated.walletId),
          traderAddress: updated.traderAddress,
          mint: updated.mint,
          closeReason: plan.closeReason,
          realizedPnlUsd: plan.realizedPnlUsd,
          realizedPnlPercent: plan.realizedPnlPercent,
        },
      }
    );
  }
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
  if (!position) {
    // A resumed sell whose position is already fully closed is simply finished.
    const finished = pending.fill?.positionId && (await WalletPosition.exists({ _id: pending.fill.positionId, status: "closed" }));
    return finished ? markDone(pending) : markSkipped(pending, "no open position on this wallet (race - already closed)");
  }

  const walletDoc = await Wallet.findById(pending.walletId);
  if (!walletDoc) return markSkipped(pending, "wallet no longer exists");

  await savePlan(WalletPendingExecution, pending, { positionId: String(position._id) });

  let plan = position.pendingClose;
  if (plan && plan.pendingId !== String(pending._id)) {
    // Someone else started closing this position. If that entry died for good, take the close over; otherwise leave it to them.
    const owner = await WalletPendingExecution.findById(plan.pendingId, { status: 1 }).lean();
    if (owner && (owner.status === "pending" || owner.status === "processing")) return markSkipped(pending, "another exit is already closing this position");
    await WalletPosition.updateOne({ _id: position._id, status: "open", "pendingClose.pendingId": plan.pendingId }, { $set: { pendingClose: null } });
    plan = null;
  }

  if (!plan) {
    let priceUsd;
    let method = "spot";
    if (position.apiPlus) {
      // Opened by an "api_plus" wallet: sold at the pool price at the moment the exit was due (a decided exit: the check moment + the execution delay).
      const price = await apiPlusFillPrice(pending);
      if (price === "wait") return;
      if (!price) return retryWithoutPrice(pending);
      priceUsd = price.priceUsd;
      method = "api_plus";
    } else if (isApiWallet(walletDoc)) {
      // What pump.fun's SDK says selling the whole position pays out right now (the sale's fee is already in it).
      const quote = await priceSell(pending.mint, position.tokenAmount).catch((err) => {
        if (err instanceof TradeError) return null; // can't be priced at all: retried like a missing price, then skipped
        throw err;
      });
      if (!quote) return retryWithoutPrice(pending);
      ({ priceUsd, method } = quote);
    } else {
      const price = await getPrice(pending.mint, { fresh: true });
      if (!price?.priceUsd) return retryWithoutPrice(pending);
      priceUsd = price.priceUsd;
    }

    // A stop-loss / trailing stop is only carried out while the price at the fill still breaches its level (db/simulation/exitTrigger.js).
    // (not for an api_plus position: the backtest acts on the sampled price alone, and so does this.)
    if (pending.trigger && CONFIRMED_EXITS.has(pending.closeReason) && method !== "api_plus") {
      const { unrealizedPercent } = computeUnrealized(position.tokenAmount * priceUsd, position.costBasisUsd + position.buyFeeUsd);
      if (!triggerHolds(pending.trigger, unrealizedPercent)) {
        return markSkipped(
          pending,
          `${pending.closeReason} not confirmed at the fill: the position is at ${unrealizedPercent.toFixed(1)}% (${method}), recovered past the ${recoveryLevel(pending.trigger)}% level (exit level ${pending.trigger.thresholdPercent}%) the sweep read ${pending.trigger.sweepPercent.toFixed(1)}% for`
        );
      }
    }

    const fresh = planClose(position, {
      priceUsd,
      fees: feeSettings(walletDoc, method),
      closeReason: pending.closeReason || "trader_sell",
      closeSignature: pending.closeReason && pending.closeReason !== "trader_sell" ? null : pending.sourceSignature,
      pendingId: pending._id,
      trigger: pending.trigger,
    });
    const claimed = await WalletPosition.findOneAndUpdate(
      { _id: position._id, status: "open", pendingClose: null },
      { $set: { pendingClose: fresh } },
      { returnDocument: "after" }
    );
    if (!claimed) return markSkipped(pending, "another exit is already closing this position");
    plan = fresh;
  }

  await bookWalletClose(position, plan);
  await markDone(pending);
}

/**
 * Every exit we decide on ourselves - stop-loss, take-profit, max hold,
 * trailing stop, blacklisted - is a SELL, so it goes through the same queue
 * as a copied trade: queued now, filled only after the execution delay, at
 * a fresh price read at that moment (executeSell). The sweep's monitoring
 * price only DECIDES that we exit; it never prices the sale.
 *
 * At most one sell can be pending per position (unique index), so if one is
 * already queued - the trader's own sell, or an exit from an earlier sweep -
 * this is a no-op. Returns true if a new exit was queued.
 */
async function queueExit(position, executionDelaySeconds, closeReason, trigger = null, decidedAtSec = null) {
  // A live wallet connected to this wallet follows the exit at once, with no execution delay (db/live/trading/mirror.js).
  mirrorExit(position, closeReason).catch((err) =>
    logEvent("trade", `Failed to queue the live ${closeReason} exit of ${position.mint} for wallet ${position.walletId}: ${err.message}`, {
      level: "error",
      meta: { walletId: String(position.walletId), traderAddress: position.traderAddress, mint: position.mint },
    })
  );
  try {
    await WalletPendingExecution.create({
      walletId: position.walletId,
      traderAddress: position.traderAddress,
      mint: position.mint,
      action: "sell",
      closeReason,
      trigger,
      // An api_plus exit is decided at a check moment that is already a little in the past: it fills the delay after THAT moment, not after now.
      triggerAt: decidedAtSec != null ? new Date((decidedAtSec + (executionDelaySeconds || 0)) * 1000) : new Date(Date.now() + (executionDelaySeconds || 0) * 1000),
      sourceSignature: `exit:${closeReason}:${position._id}`,
    });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // a sell for this position is already queued
    throw err;
  }
}

/** Wallet-scoped mirror of db/simulation/executor.js's closeAllPositionsForTrader - every wallet this trader has open positions on. */
export async function closeAllWalletPositionsForTrader(traderAddress, closeReason = "blacklisted") {
  await WalletPendingExecution.updateMany(
    { traderAddress, action: "buy", status: "pending" },
    { $set: { status: "skipped", skipReason: "trader blacklisted", processedAt: new Date() } }
  );

  // Sold like any other trade - queued, filled after the wallet's execution delay at a fresh price.
  const open = await WalletPosition.find({ traderAddress, status: "open" });
  const walletCache = new Map();
  for (const position of open) {
    const key = String(position.walletId);
    if (!walletCache.has(key)) walletCache.set(key, await Wallet.findById(position.walletId));
    const wallet = walletCache.get(key);
    if (wallet) await queueExit(position, wallet.settings.executionDelaySeconds, closeReason);
  }
  return { closing: open.length };
}

/** Wallet-scoped mirror of processDuePendingExecutions - same atomic-claim pattern, own collection. */
export async function processDueWalletExecutions() {
  await reapStale(WalletPendingExecution);
  // Exits first: a position waiting to be closed matters more than one waiting to be opened.
  const due = await WalletPendingExecution.find({ status: "pending", triggerAt: { $lte: new Date() } })
    .sort({ action: -1, triggerAt: 1 })
    .limit(50);
  let processed = 0;
  for (const item of due) {
    const claimed = await WalletPendingExecution.findOneAndUpdate(
      { _id: item._id, status: "pending" },
      { $set: { status: "processing", leaseUntil: leaseExpiry() } },
      { returnDocument: "after" }
    );
    if (!claimed) continue;
    try {
      if (claimed.action === "buy") await executeWalletBuy(claimed);
      else await executeWalletSell(claimed);
      processed += 1;
    } catch (err) {
      await failOrRetry(WalletPendingExecution, claimed, err);
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
  const openPositions = await WalletPosition.find({ status: "open", apiPlus: null }); // api_plus positions have their own schedule: checkApiPlusExits

  // Same reasoning as checkRiskExits: warm the cache for every distinct
  // mint in bounded batches before the per-position fan-out below, instead
  // of that Promise.all firing one curl process per distinct mint at once.
  const walletCache = new Map();
  for (const walletId of new Set(openPositions.map((p) => String(p.walletId)))) {
    walletCache.set(walletId, (await Wallet.findById(walletId)) ?? null);
  }

  // An API wallet's positions are valued at what pump.fun's SDK says selling them pays out right now (one batched read for all of
  // them, nothing cached between sweeps); the others at the spot price, warmed in one batch below.
  const apiPositions = openPositions.filter((p) => isApiWallet(walletCache.get(String(p.walletId))));
  const apiValues = await valueMany(apiPositions.map((p) => ({ id: String(p._id), mint: p.mint, tokenAmount: p.tokenAmount })));
  const apiIds = new Set(apiPositions.map((p) => String(p._id)));
  await prefetchPrices(
    openPositions.filter((p) => !apiIds.has(String(p._id))).map((p) => p.mint),
    { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP }
  );
  // Traders blacklisted while a position was open - closed below (backstop
  // for closeAllWalletPositionsForTrader when no price was available then).
  const traderAddresses = [...new Set(openPositions.map((p) => p.traderAddress))];
  const blacklisted = new Set(
    (await Trader.find({ address: { $in: traderAddresses }, status: "blacklisted" }, { address: 1 }).lean()).map((t) => t.address)
  );

  const results = await Promise.all(
    openPositions.map(async (position) => {
      const wallet = walletCache.get(String(position.walletId));
      if (!wallet) return false;

      const isApi = apiIds.has(String(position._id));
      let currentValue;
      let priceSource;
      if (isApi) {
        const value = apiValues.get(String(position._id));
        if (!value) return false; // couldn't be priced this sweep - checked again on the next one
        currentValue = value.valueUsd;
        priceSource = `${value.method}_quote`;
      } else {
        const price = await getPrice(position.mint, { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });
        if (!price?.priceUsd) return false;
        currentValue = position.tokenAmount * price.priceUsd;
        priceSource = price.source;
      }
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
      if (blacklisted.has(position.traderAddress)) {
        return !!(await queueExit(position, settings.executionDelaySeconds, "blacklisted"));
      }
      const hasStopLoss = settings.stopLossPercent !== null && settings.stopLossPercent !== undefined;
      const hasTakeProfit = settings.takeProfitPercent !== null && settings.takeProfitPercent !== undefined;
      const hasMaxHoldTime = !!settings.maxTradeTimeSeconds && settings.maxTradeTimeSeconds > 0;
      const trailingStops = settings.trailingStops || [];
      if (!hasStopLoss && !hasTakeProfit && !hasMaxHoldTime && trailingStops.length === 0) return false;

      // What this sweep saw, kept with every exit it queues (db/simulation/exitTrigger.js).
      const triggerFor = (kind, thresholdPercent, rule) =>
        buildTrigger(kind, {
          thresholdPercent,
          unrealizedPercent,
          valueUsd: currentValue,
          priceUsd: currentValue / position.tokenAmount,
          priceSource,
          rule,
        });
      // Stop-loss and trailing stops are judged on a LOW price, so a fresh read (valued the way this wallet values it) must agree
      // before the exit is queued - this also keeps a connected live wallet from mirroring an exit that was a bad reading.
      const confirmed = (trigger) =>
        confirmExit(trigger, {
          totalCost,
          valueNow: async () => {
            if (isApi) return (await valueMany([{ id: String(position._id), mint: position.mint, tokenAmount: position.tokenAmount }])).get(String(position._id))?.valueUsd ?? null;
            const now = await getPrice(position.mint, { fresh: true });
            return now?.priceUsd ? position.tokenAmount * now.priceUsd : null;
          },
          meta: { walletId: String(position.walletId), traderAddress: position.traderAddress, mint: position.mint },
        });

      if (hasStopLoss && unrealizedPercent <= -Math.abs(settings.stopLossPercent)) {
        const trigger = await confirmed(triggerFor("stop_loss", -Math.abs(settings.stopLossPercent)));
        return !!trigger && !!(await queueExit(position, settings.executionDelaySeconds, "stop_loss", trigger));
      }

      if (hasTakeProfit && unrealizedPercent >= Math.abs(settings.takeProfitPercent)) {
        return !!(await queueExit(position, settings.executionDelaySeconds, "take_profit", triggerFor("take_profit", Math.abs(settings.takeProfitPercent))));
      }

      if (hasMaxHoldTime) {
        const elapsedSeconds = (Date.now() - position.openedAt.getTime()) / 1000;
        if (elapsedSeconds >= settings.maxTradeTimeSeconds) {
          return !!(await queueExit(position, settings.executionDelaySeconds, "max_hold_time", triggerFor("max_hold_time", null)));
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
            const trigger = await confirmed(triggerFor("trailing_stop", rule.exitPercent, rule));
            return !!trigger && !!(await queueExit(position, settings.executionDelaySeconds, "trailing_stop", trigger));
          }
        }
      }
      return false;
    })
  );

  return results.filter(Boolean).length;
}

const API_PLUS_MAX_CATCH_UP = 12; // check moments judged per position per call, if the daemon was away for a while
const API_PLUS_PARALLEL = 8;

/**
 * The risk sweep of "api_plus" positions: the backtest's sampling (db/backtest/simulator.js) run live. Each position has its own schedule of
 * check moments (Te + phase + k x interval, see db/simulation/apiPlus.js); a moment is judged on the pool price AT that moment, read from the token's
 * trade list once it is old enough to be listed. Same rules in the same order as the backtest - stop-loss, take-profit, max hold time, trailing
 * stops - with no re-check of a low reading. An exit is decided at its moment and fills the execution delay after it.
 *
 * Meant to be called about once a second: the schedule, not the call, decides when a position is looked at. Returns how many exits were queued.
 */
export async function checkApiPlusExits() {
  const positions = await WalletPosition.find({ status: "open", "apiPlus.nextSweepAtSec": { $ne: null } });
  if (positions.length === 0) return 0;

  const wallets = new Map();
  for (const walletId of new Set(positions.map((p) => String(p.walletId)))) wallets.set(walletId, (await Wallet.findById(walletId)) ?? null);
  const blacklisted = new Set(
    (await Trader.find({ address: { $in: [...new Set(positions.map((p) => p.traderAddress))] }, status: "blacklisted" }, { address: 1 }).lean()).map((t) => t.address)
  );

  let queued = 0;
  for (let i = 0; i < positions.length; i += API_PLUS_PARALLEL) {
    const results = await Promise.all(
      positions.slice(i, i + API_PLUS_PARALLEL).map((position) =>
        sweepApiPlusPosition(position, wallets.get(String(position.walletId)), blacklisted.has(position.traderAddress)).catch((err) => {
          logEvent("trade", `[wallet] API+ check of ${position.mint} failed: ${err.message}`, { level: "warn", meta: { walletId: String(position.walletId), mint: position.mint } });
          return false;
        })
      )
    );
    queued += results.filter(Boolean).length;
  }
  return queued;
}

async function sweepApiPlusPosition(position, wallet, isBlacklisted) {
  if (!wallet) return false;
  const settings = wallet.settings;
  if (isBlacklisted) return !!(await queueExit(position, settings.executionDelaySeconds, "blacklisted"));

  const stopLoss = settings.stopLossPercent;
  const takeProfit = settings.takeProfitPercent;
  const maxHold = settings.maxTradeTimeSeconds > 0 ? settings.maxTradeTimeSeconds : 0;
  const trailingStops = settings.trailingStops || [];
  if ((stopLoss == null) && (takeProfit == null) && maxHold === 0 && trailingStops.length === 0) return false; // nothing to judge, as in the backtest

  const { fillAtSec, intervalSec } = position.apiPlus;
  const totalCost = position.costBasisUsd + position.buyFeeUsd;
  const armed = new Set(position.armedTrailingStopIds.map(String));
  let nextAt = position.apiPlus.nextSweepAtSec;

  for (let n = 0; n < API_PLUS_MAX_CATCH_UP; n++) {
    const nowSec = Date.now() / 1000;
    if (nowSec < nextAt + INDEX_LAG_SEC) return false;
    const sample = await poolPriceAt(position.mint, nextAt, { nowSec });
    if (!sample) return false; // not listed yet - looked at again on the next call
    const at = nextAt;
    nextAt = at + intervalSec;

    const currentValue = position.tokenAmount * sample.priceUsd;
    const { unrealizedUsd, unrealizedPercent } = computeUnrealized(currentValue, totalCost);

    // Same decision order as the backtest's evaluate().
    let reason = null;
    let threshold = null;
    let rule = null;
    if (stopLoss != null && unrealizedPercent <= -Math.abs(stopLoss)) {
      reason = "stop_loss";
      threshold = -Math.abs(stopLoss);
    } else if (takeProfit != null && unrealizedPercent >= Math.abs(takeProfit)) {
      reason = "take_profit";
      threshold = Math.abs(takeProfit);
    } else if (maxHold > 0 && at >= fillAtSec + maxHold) {
      reason = "max_hold_time";
    } else {
      for (const r of trailingStops) {
        const id = String(r._id);
        if (!armed.has(id)) {
          if (unrealizedPercent >= r.armPercent) armed.add(id);
        } else if (unrealizedPercent <= r.exitPercent) {
          reason = "trailing_stop";
          threshold = r.exitPercent;
          rule = r;
          break;
        }
      }
    }

    // This moment is judged: move the schedule on, record the peak / trough and which trailing stops are armed - in one guarded write.
    const set = { "apiPlus.nextSweepAtSec": nextAt };
    if (currentValue > position.maxValueUsd) Object.assign(set, { maxValueUsd: currentValue, maxUnrealizedPnlUsd: unrealizedUsd, maxUnrealizedPnlPercent: unrealizedPercent });
    if (position.minValueUsd === null || currentValue < position.minValueUsd) Object.assign(set, { minValueUsd: currentValue, minUnrealizedPnlUsd: unrealizedUsd, minUnrealizedPnlPercent: unrealizedPercent });
    const advanced = await WalletPosition.updateOne(
      { _id: position._id, status: "open", "apiPlus.nextSweepAtSec": at },
      { $set: { ...set, armedTrailingStopIds: [...armed] } }
    );
    if (advanced.modifiedCount === 0) return false; // another pass judged this moment (or the position closed)
    Object.assign(position, { maxValueUsd: set.maxValueUsd ?? position.maxValueUsd, minValueUsd: set.minValueUsd ?? position.minValueUsd });

    if (reason) {
      const trigger = buildTrigger(reason, {
        thresholdPercent: threshold,
        unrealizedPercent,
        valueUsd: currentValue,
        priceUsd: sample.priceUsd,
        priceSource: `api_plus_${sample.source}`,
        rule,
      });
      return !!(await queueExit(position, settings.executionDelaySeconds, reason, trigger, at));
    }
  }
  return false;
}
