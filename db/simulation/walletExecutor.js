import mongoose from "mongoose";
import { Trader } from "../models/Trader.js";
import { Wallet } from "../models/Wallet.js";
import { WalletTrader } from "../models/WalletTrader.js";
import { WalletPosition } from "../models/WalletPosition.js";
import { WalletPendingExecution } from "../models/WalletPendingExecution.js";
import { getPrice, prefetchPrices, PRICE_MAX_AGE } from "../pumpFunApi.js";
import { logEvent } from "../systemLog.js";
import { computeTradeFees, realizedCounterDeltaOnClose } from "../fees.js";
import { applyOnce, wasApplied, savePlan, leaseExpiry, failOrRetry, reapStale } from "./atomic.js";
import { isTradingPaused } from "./guards.js";
import { mirrorExit } from "../live/trading/mirror.js";
import { TradeError } from "../live/trading/pumpSwap.js";
import { priceBuy, priceSell, valueMany } from "./sdkQuote.js";
import { tokenHasTrades } from "./apiClients.js";
import { CONFIRMED_EXITS, buildTrigger, confirmExit, triggerHolds } from "./exitTrigger.js";

/** Wallets that follow their traders through pump.fun's API (Wallet.settings.trackingMethod) fill and are checked at SDK quotes, not spot prices. */
const isApiWallet = (wallet) => wallet?.settings?.trackingMethod === "api";

/**
 * The fee settings a fill is charged with. An SDK quote already has pump.fun's fee inside it (the budget is spent INCLUDING the
 * fee, a sale pays out AFTER it), so charging the pump-fee percentage on top would take it twice; only the Jito fee is added.
 * A "spot" price (a token the SDK can't quote, or any logs-wallet fill) has no fee in it, so the setting applies as usual.
 */
const feeSettings = (wallet, method) => ({ pumpFeePercent: method === "sdk" ? 0 : wallet.settings.pumpFeePercent, jitoFeeUsd: wallet.settings.jitoFeeUsd });

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
    if (isApiWallet(walletDoc)) {
      // Last check before an API wallet buys: the token must have real trades on pump.fun. An empty answer skips the buy; a failed
      // request throws (and is retried) rather than being mistaken for an empty token.
      if (!(await tokenHasTrades(pending.mint))) return markSkipped(pending, "no trades on this token (pump.fun's trades API returned none)");
      // The fill is what pump.fun's SDK says spending the trade size buys right now.
      const quote = await priceBuy(pending.mint, spendUsd).catch((err) => {
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
    const buyFees = computeTradeFees(spendUsd, feeSettings(walletDoc, method));
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
    if (isApiWallet(walletDoc)) {
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
    if (pending.trigger && CONFIRMED_EXITS.has(pending.closeReason)) {
      const { unrealizedPercent } = computeUnrealized(position.tokenAmount * priceUsd, position.costBasisUsd + position.buyFeeUsd);
      if (!triggerHolds(pending.trigger, unrealizedPercent)) {
        return markSkipped(
          pending,
          `${pending.closeReason} not confirmed at the fill: the position is at ${unrealizedPercent.toFixed(1)}% (${method}), above the ${pending.trigger.thresholdPercent}% level the sweep read ${pending.trigger.sweepPercent.toFixed(1)}% for`
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
async function queueExit(position, executionDelaySeconds, closeReason, trigger = null) {
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
      triggerAt: new Date(Date.now() + (executionDelaySeconds || 0) * 1000),
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
  const openPositions = await WalletPosition.find({ status: "open" });

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
