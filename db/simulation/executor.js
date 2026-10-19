import mongoose from "mongoose";
import { Trader } from "../models/Trader.js";
import { ProfileTrader } from "../models/ProfileTrader.js";
import { SimPosition } from "../models/SimPosition.js";
import { PendingExecution } from "../models/PendingExecution.js";
import { NegativeBalanceEvent } from "../models/NegativeBalanceEvent.js";
import { resolveTraderSettings } from "../settings.js";
import { getPrice, prefetchPrices, PRICE_MAX_AGE } from "../pumpFunApi.js";
import { logEvent } from "../systemLog.js";
import { computeTradeFees, realizedCounterDeltaOnClose } from "../fees.js";
import { applyOnce, wasApplied, savePlan, leaseExpiry, failOrRetry, reapStale } from "./atomic.js";
import { isTradingPaused } from "./guards.js";

// ProfileTrader keeps everything of one (profile, trader) pair in one document, so a balance + counters change is ONE
// atomic write; the applied-operation keys live in its sim subdocument.
const OPS = { path: "sim.appliedOps" };

async function markSkipped(pending, reason) {
  pending.status = "skipped";
  pending.skipReason = reason;
  pending.processedAt = new Date();
  pending.leaseUntil = null;
  await pending.save();
  logEvent(
    "trade",
    `Skipped ${pending.action} of ${pending.mint} for ${pending.traderAddress}: ${reason}`,
    { level: "warn", meta: { profileId: String(pending.profileId), traderAddress: pending.traderAddress, mint: pending.mint, action: pending.action, reason } }
  );
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

/** Unrealized $ / % for a position given its current token value (tokenAmount * price) and its fixed cost basis. */
function computeUnrealized(currentValueUsd, totalCost) {
  const unrealizedUsd = currentValueUsd - totalCost;
  const unrealizedPercent = totalCost > 0 ? (unrealizedUsd / totalCost) * 100 : 0;
  return { unrealizedUsd, unrealizedPercent };
}

/**
 * Records that a debit pushed a balance below zero: the lifetime counters, plus a timestamped record of this crossing so
 * day-by-day stats (count + deepest point for that day) can be computed. `after` is the balance the debit itself returned,
 * not a value read earlier, so concurrent fills can't make these numbers wrong.
 */
async function recordNegativeBalance(profileTrader, after, key) {
  const applied = await applyOnce(
    ProfileTrader,
    { _id: profileTrader._id },
    key,
    { $inc: { "sim.negativeBalanceEventCount": 1 }, $max: { "sim.maxNegativeBalanceUsd": Math.abs(after) } },
    OPS
  );
  if (!applied) return;
  await NegativeBalanceEvent.create({
    profileId: profileTrader.profileId,
    traderAddress: profileTrader.traderAddress,
    balanceUsd: after,
    depthUsd: Math.abs(after),
  });
}

/**
 * Profile-path buy. Crash-safe the same way as the wallet path (see db/simulation/atomic.js and walletExecutor.js): the
 * plan is saved on the queue entry first, then (1) the debit - which, unlike before, happens BEFORE the position exists and
 * is a conditional atomic update when negative balances are off - (2) the position under the planned id, (3) the dedup mark.
 */
async function executeBuy(pending) {
  const profileTrader = await ProfileTrader.findOne({ profileId: pending.profileId, traderAddress: pending.traderAddress });
  if (!profileTrader) return markSkipped(pending, "profile/trader state missing (race)");

  let fill = pending.fill;
  let settings = null;
  if (!fill) {
    if (await isTradingPaused()) return markSkipped(pending, "trading is paused (kill switch)");

    const trader = await Trader.findOne({ address: pending.traderAddress });
    if (!trader || trader.status !== "active") return markSkipped(pending, "trader inactive or blacklisted");
    if (profileTrader.sim.everBoughtMints.includes(pending.mint)) return markSkipped(pending, "already bought this mint (race)");

    const existingOpen = await SimPosition.exists({ profileId: pending.profileId, traderAddress: trader.address, mint: pending.mint, status: "open" });
    if (existingOpen) return markSkipped(pending, "position already open (race)");

    settings = await resolveTraderSettings(pending.profileId, trader.address, { profileTrader });
    const spendUsd = settings.tradeSizeUsd;
    const buyFees = computeTradeFees(spendUsd, settings);
    const totalCost = spendUsd + buyFees.totalFeeUsd;
    // Early, cheap check; the real guarantee is the conditional debit below.
    if (!settings.allowNegativeBalance && profileTrader.sim.balanceUsd < totalCost) {
      return markSkipped(pending, "insufficient balance and negative balance is disabled for this trader");
    }

    const price = await getPrice(pending.mint, { fresh: true });
    if (!price?.priceUsd) return retryWithoutPrice(pending);

    fill = await savePlan(PendingExecution, pending, {
      positionId: String(new mongoose.Types.ObjectId()),
      priceUsd: price.priceUsd,
      spendUsd,
      feeUsd: buyFees.totalFeeUsd,
      pumpFeeUsd: buyFees.pumpFeeUsd,
      jitoFeeUsd: buyFees.jitoFeeUsd,
      totalCost,
      tokenAmount: spendUsd / price.priceUsd,
      allowNegative: !!settings.allowNegativeBalance,
    });
  }

  const { spendUsd, feeUsd, totalCost } = fill;
  const opKey = `buy:${pending._id}`;

  // ---- step 1: debit + open-position counter + the buy fee into realized P&L (money already gone, see db/fees.js).
  const debited = await applyOnce(
    ProfileTrader,
    { _id: profileTrader._id, ...(fill.allowNegative ? {} : { "sim.balanceUsd": { $gte: totalCost } }) },
    opKey,
    { $inc: { "sim.balanceUsd": -totalCost, "sim.realizedPnlUsd": -feeUsd, "sim.openPositionCount": 1 } },
    OPS
  );
  if (!debited && !(await wasApplied(ProfileTrader, { _id: profileTrader._id }, opKey, OPS))) {
    return markSkipped(pending, "insufficient balance and negative balance is disabled for this trader");
  }
  if (debited && debited.sim.balanceUsd < 0) await recordNegativeBalance(profileTrader, debited.sim.balanceUsd, `neg:${pending._id}`);

  // ---- step 2: the position, under the planned id (a repeat finds it already there).
  // At t=0 the position is worth exactly what was spent on it (that's the definition of costBasisUsd) - the fee is a
  // separate, already-realized cost, so the very first "unrealized" reading is -feeUsd, not 0. This is also the starting
  // point the peak-tracker (maxValueUsd) grows from.
  const initialUnrealized = computeUnrealized(spendUsd, totalCost);
  try {
    await SimPosition.create({
      _id: fill.positionId,
      profileId: pending.profileId,
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
      // Unique index on (profileId, traderAddress, mint) where status="open": a different position is already open, so
      // this buy never happened - give the money back, once.
      await applyOnce(
        ProfileTrader,
        { _id: profileTrader._id },
        `refund:${pending._id}`,
        { $inc: { "sim.balanceUsd": totalCost, "sim.realizedPnlUsd": feeUsd, "sim.openPositionCount": -1 } },
        OPS
      );
      return markSkipped(pending, "position already open (lost the race)");
    }
    // else: our own position already exists - a resumed fill, carry on
  }

  // ---- step 3: permanent per-mint dedup mark. Guarded by "mint not yet recorded", so it applies once.
  await ProfileTrader.updateOne(
    { _id: profileTrader._id, "sim.everBoughtMints": { $ne: pending.mint } },
    { $addToSet: { "sim.everBoughtMints": pending.mint }, $set: { "sim.lastActionAt": new Date() } }
  );

  await markDone(pending);
  logEvent("trade", `Bought ${pending.mint} for ${pending.traderAddress}: $${spendUsd.toFixed(2)} + $${feeUsd.toFixed(2)} fees @ $${fill.priceUsd}`, {
    meta: { profileId: String(pending.profileId), traderAddress: pending.traderAddress, mint: pending.mint, spendUsd, feeUsd, priceUsd: fill.priceUsd },
  });
}

/** Freezes the numbers of a close - see planClose in walletExecutor.js; identical maths, stored on the position (pendingClose) before anything is paid out. */
function planClose(position, { priceUsd, fees, closeReason, closeSignature, pendingId }) {
  const proceedsUsd = position.tokenAmount * priceUsd;
  const sellFees = computeTradeFees(proceedsUsd, fees);
  const totalCost = position.costBasisUsd + position.buyFeeUsd;
  const netProceeds = proceedsUsd - sellFees.totalFeeUsd;
  const realizedPnlUsd = netProceeds - totalCost;
  // The closing price is one more price sample - folded into the peak/trough trackers in case this position closed at (or
  // beyond) its extreme and the periodic risk-check never happened to sample that exact moment.
  const closeUnrealized = computeUnrealized(proceedsUsd, totalCost);
  return {
    pendingId: String(pendingId),
    closeReason,
    closeSignature,
    priceUsd,
    proceedsUsd,
    feeUsd: sellFees.totalFeeUsd,
    pumpFeeUsd: sellFees.pumpFeeUsd,
    jitoFeeUsd: sellFees.jitoFeeUsd,
    netProceeds,
    realizedPnlUsd,
    realizedPnlPercent: totalCost > 0 ? (realizedPnlUsd / totalCost) * 100 : 0,
    realizedDelta: realizedCounterDeltaOnClose(position, realizedPnlUsd),
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
 * Pays out a planned close, then flips the position to "closed" LAST: "closed" always means "fully booked", and a position
 * still "open" with a pendingClose plan is a close that can be resumed. Safe to call twice for the same plan - the payout is
 * keyed, and the flip is guarded by status:"open". (This also is the guard against double-closing: executeSell (every ~2s,
 * mirroring the trader) and checkRiskExits (stop-loss/take-profit/...) can both decide to close the same position, and only
 * the one that stored the plan first gets to book it.)
 */
async function bookClose(position, plan) {
  await applyOnce(
    ProfileTrader,
    { profileId: position.profileId, traderAddress: position.traderAddress },
    `close:${position._id}`,
    {
      $inc: {
        "sim.balanceUsd": plan.netProceeds,
        "sim.openPositionCount": -1,
        "sim.closedPositionCount": 1,
        "sim.realizedPnlUsd": plan.realizedDelta,
      },
      $set: { "sim.lastActionAt": new Date() },
    },
    OPS
  );

  const updated = await SimPosition.findOneAndUpdate(
    { _id: position._id, status: "open" },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        closeReason: plan.closeReason,
        closeTriggerSignature: plan.closeSignature,
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
      `Closed ${updated.mint} for ${updated.traderAddress}: ${plan.closeReason} pnl=$${plan.realizedPnlUsd.toFixed(2)} (${plan.realizedPnlPercent.toFixed(1)}%)`,
      {
        meta: {
          profileId: String(updated.profileId),
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

async function executeSell(pending) {
  const trader = await Trader.findOne({ address: pending.traderAddress });
  if (!trader) return markSkipped(pending, "trader not found");

  const position = await SimPosition.findOne({ profileId: pending.profileId, traderAddress: pending.traderAddress, mint: pending.mint, status: "open" });
  if (!position) {
    // A resumed sell whose position is already fully closed is simply finished.
    const finished = pending.fill?.positionId && (await SimPosition.exists({ _id: pending.fill.positionId, status: "closed" }));
    return finished ? markDone(pending) : markSkipped(pending, "no open position (race - already closed)");
  }

  await savePlan(PendingExecution, pending, { positionId: String(position._id) });

  let plan = position.pendingClose;
  if (plan && plan.pendingId !== String(pending._id)) {
    // Someone else started closing this position. If that entry died for good, take the close over; otherwise leave it to them.
    const owner = await PendingExecution.findById(plan.pendingId, { status: 1 }).lean();
    if (owner && (owner.status === "pending" || owner.status === "processing")) return markSkipped(pending, "another exit is already closing this position");
    await SimPosition.updateOne({ _id: position._id, status: "open", "pendingClose.pendingId": plan.pendingId }, { $set: { pendingClose: null } });
    plan = null;
  }

  if (!plan) {
    const settings = await resolveTraderSettings(pending.profileId, pending.traderAddress);
    const price = await getPrice(pending.mint, { fresh: true });
    if (!price?.priceUsd) return retryWithoutPrice(pending);

    const fresh = planClose(position, {
      priceUsd: price.priceUsd,
      fees: settings,
      closeReason: pending.closeReason || "trader_sell",
      closeSignature: pending.closeReason && pending.closeReason !== "trader_sell" ? null : pending.sourceSignature,
      pendingId: pending._id,
    });
    const claimed = await SimPosition.findOneAndUpdate(
      { _id: position._id, status: "open", pendingClose: null },
      { $set: { pendingClose: fresh } },
      { returnDocument: "after" }
    );
    if (!claimed) return markSkipped(pending, "another exit is already closing this position");
    plan = fresh;
  }

  await bookClose(position, plan);
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
async function queueExit(position, executionDelaySeconds, closeReason) {
  try {
    await PendingExecution.create({
      profileId: position.profileId,
      traderAddress: position.traderAddress,
      mint: position.mint,
      action: "sell",
      closeReason,
      triggerAt: new Date(Date.now() + (executionDelaySeconds || 0) * 1000),
      sourceSignature: `exit:${closeReason}:${position._id}`,
    });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // a sell for this position is already queued
    throw err;
  }
}

/**
 * Closes every open position this trader has, in every profile, at the
 * current price (normal sell fees apply), and cancels anything still queued
 * for them. Called the moment a trader is blacklisted - once blacklisted
 * they're no longer watched, so no "trader sold" signal would ever arrive
 * to close these. A position whose price can't be fetched right now is left
 * open here and picked up by checkRiskExits' blacklisted check on its next
 * sweep (a few seconds later).
 */
export async function closeAllPositionsForTrader(traderAddress, closeReason = "blacklisted") {
  // Cancel queued BUYS only - a sell already queued for a position is kept
  // (it closes that position anyway, after its own delay).
  await PendingExecution.updateMany(
    { traderAddress, action: "buy", status: "pending" },
    { $set: { status: "skipped", skipReason: "trader blacklisted", processedAt: new Date() } }
  );

  // Each open position is SOLD like any other trade: queued, filled after
  // that profile's execution delay at a fresh price (see queueExit).
  const open = await SimPosition.find({ traderAddress, status: "open" });
  for (const position of open) {
    const settings = await resolveTraderSettings(position.profileId, traderAddress);
    await queueExit(position, settings.executionDelaySeconds, closeReason);
  }
  return { closing: open.length };
}

/**
 * Fills any queued buy/sell whose execution-delay has elapsed, across every
 * profile. Call this on a short interval (e.g. every 1-2s). Each item is
 * atomically claimed (pending -> processing, with a lease) via findOneAndUpdate
 * before it's acted on, so an overlapping run (e.g. a slow price lookup causing
 * one interval tick to still be running when the next one fires) can never
 * process the same item twice. An item whose run died keeps "processing" past
 * its lease and is re-queued by reapStale, then resumed from its saved plan.
 */
export async function processDuePendingExecutions() {
  await reapStale(PendingExecution);
  // Exits first: a position waiting to be closed matters more than one waiting to be opened.
  const due = await PendingExecution.find({ status: "pending", triggerAt: { $lte: new Date() } })
    .sort({ action: -1, triggerAt: 1 })
    .limit(50);
  let processed = 0;
  for (const item of due) {
    const claimed = await PendingExecution.findOneAndUpdate(
      { _id: item._id, status: "pending" },
      { $set: { status: "processing", leaseUntil: leaseExpiry() } },
      { returnDocument: "after" }
    );
    if (!claimed) continue; // another (overlapping) run already claimed this one
    try {
      if (claimed.action === "buy") await executeBuy(claimed);
      else await executeSell(claimed);
      processed += 1;
    } catch (err) {
      await failOrRetry(PendingExecution, claimed, err);
    }
  }
  return processed;
}

/**
 * Runs on every open position across every profile, every risk-check tick
 * (see SystemSettings.riskCheckIntervalSeconds - one system-wide cadence,
 * not per-profile, since this is a single sweep over everyone's positions):
 * always updates the peak-value tracker (maxValueUsd/maxUnrealizedPnlUsd/
 * maxUnrealizedPnlPercent, shown in the trade-history detail view as
 * "peaked at X% before closing at Y%"), and - independently, only if that
 * position's OWN profile has the relevant setting enabled for this trader -
 * force-closes/arms the position based on that profile's risk settings.
 * Close checks run in this order (each can disable itself - stopLoss/
 * takeProfit via null, maxTradeTimeSeconds via 0, trailingStops via an
 * empty list):
 *
 *  1. Stop-loss: unrealized loss <= -stopLossPercent -> close ("stop_loss").
 *  2. Take-profit: unrealized gain >= takeProfitPercent -> close ("take_profit").
 *  3. Max trade time: position has been open >= maxTradeTimeSeconds and the
 *     trader still hasn't sold -> close ("max_hold_time").
 *  4. Trailing stops: any number of independent {armPercent, exitPercent}
 *     rules. A rule "arms" the first time unrealized gain reaches its
 *     armPercent (persisted per-rule on the position via
 *     armedTrailingStopIds, so it survives between ticks even if price dips
 *     and recovers); once armed, if the position falls back to that rule's
 *     exitPercent (or below), it's closed ("trailing_stop"). Whichever
 *     configured rule triggers first wins - e.g. "arm at 25%, exit at -10%"
 *     and "arm at 50%, exit at 20%" can both be configured and race
 *     independently.
 *
 * "Close" above means the exit is QUEUED (queueExit), not filled here:
 * every exit is a sell, so it waits the execution delay and then fills at a
 * fresh price, exactly like a copied trade. Returns how many exits it queued.
 */
export async function checkRiskExits() {
  const openPositions = await SimPosition.find({ status: "open" });

  // Warms the price cache for every distinct mint in bounded batches (see
  // prefetchPrices) BEFORE the per-position fan-out below - without this,
  // that Promise.all would fire one curl process per distinct mint all at
  // once, which is what was overloading the proxy pool/triggering pump.fun
  // rate limits in the first place.
  await prefetchPrices(openPositions.map((p) => p.mint), { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });

  const traderCache = new Map();
  const settingsCache = new Map(); // `${profileId}:${traderAddress}` -> resolved settings

  // Every position is checked concurrently (price lookup, peak/lowest
  // update, and any resulting close) rather than one at a time - with many
  // open positions across different mints, a sequential sweep can take far
  // longer than the configured check interval, and since this loop
  // self-reschedules only after the FULL sweep finishes, a slow sweep
  // silently balloons the real gap between samples for every position in
  // it, which is exactly how a genuine intra-trade peak/dip gets missed
  // between checks. Running them concurrently bounds one sweep's wall-clock
  // time to roughly the single slowest lookup instead of the sum of all of
  // them. traderCache/settingsCache are best-effort under this concurrency -
  // two positions for the same trader racing a cache miss just means one
  // redundant lookup, never incorrect data.
  const results = await Promise.all(
    openPositions.map(async (position) => {
      let trader = traderCache.get(position.traderAddress);
      if (trader === undefined) {
        trader = await Trader.findOne({ address: position.traderAddress });
        traderCache.set(position.traderAddress, trader ?? null);
      }
      if (!trader) return false;

      const price = await getPrice(position.mint, { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });
      if (!price?.priceUsd) return false;

      // Backstop for closeAllPositionsForTrader: anything it couldn't price at
      // blacklist time is closed here on the next sweep.
      if (trader.status === "blacklisted") {
        const traderSettings = await resolveTraderSettings(position.profileId, position.traderAddress);
        return !!(await queueExit(position, traderSettings.executionDelaySeconds, "blacklisted"));
      }

      const currentValue = position.tokenAmount * price.priceUsd;
      const totalCost = position.costBasisUsd + position.buyFeeUsd;
      const { unrealizedUsd, unrealizedPercent } = computeUnrealized(currentValue, totalCost);

      if (currentValue > position.maxValueUsd) {
        await SimPosition.updateOne(
          { _id: position._id, status: "open" },
          { $set: { maxValueUsd: currentValue, maxUnrealizedPnlUsd: unrealizedUsd, maxUnrealizedPnlPercent: unrealizedPercent } }
        );
        position.maxValueUsd = currentValue; // keep the in-memory copy consistent for the arm check below
      }

      if (position.minValueUsd === null || currentValue < position.minValueUsd) {
        await SimPosition.updateOne(
          { _id: position._id, status: "open" },
          { $set: { minValueUsd: currentValue, minUnrealizedPnlUsd: unrealizedUsd, minUnrealizedPnlPercent: unrealizedPercent } }
        );
        position.minValueUsd = currentValue;
      }

      const cacheKey = `${position.profileId}:${position.traderAddress}`;
      let settings = settingsCache.get(cacheKey);
      if (!settings) {
        const profileTrader = await ProfileTrader.findOne({ profileId: position.profileId, traderAddress: position.traderAddress });
        settings = await resolveTraderSettings(position.profileId, position.traderAddress, { profileTrader });
        settingsCache.set(cacheKey, settings);
      }

      const hasStopLoss = settings.stopLossPercent !== null && settings.stopLossPercent !== undefined;
      const hasTakeProfit = settings.takeProfitPercent !== null && settings.takeProfitPercent !== undefined;
      const hasMaxHoldTime = !!settings.maxTradeTimeSeconds && settings.maxTradeTimeSeconds > 0;
      const trailingStops = settings.trailingStops || [];
      if (!hasStopLoss && !hasTakeProfit && !hasMaxHoldTime && trailingStops.length === 0) return false;

      if (hasStopLoss && unrealizedPercent <= -Math.abs(settings.stopLossPercent)) {
        return !!(await queueExit(position, settings.executionDelaySeconds, "stop_loss"));
      }

      if (hasTakeProfit && unrealizedPercent >= Math.abs(settings.takeProfitPercent)) {
        return !!(await queueExit(position, settings.executionDelaySeconds, "take_profit"));
      }

      if (hasMaxHoldTime) {
        const elapsedSeconds = (Date.now() - position.openedAt.getTime()) / 1000;
        if (elapsedSeconds >= settings.maxTradeTimeSeconds) {
          return !!(await queueExit(position, settings.executionDelaySeconds, "max_hold_time"));
        }
      }

      if (trailingStops.length > 0) {
        const armedIds = new Set(position.armedTrailingStopIds.map(String));
        for (const rule of trailingStops) {
          const ruleId = String(rule._id);
          if (!armedIds.has(ruleId)) {
            if (unrealizedPercent >= rule.armPercent) {
              await SimPosition.updateOne({ _id: position._id, status: "open" }, { $addToSet: { armedTrailingStopIds: ruleId } });
              logEvent(
                "trade",
                `Trailing-stop armed on ${position.mint} for ${position.traderAddress} at +${unrealizedPercent.toFixed(1)}% (exits at ${rule.exitPercent}%)`,
                {
                  meta: {
                    profileId: String(position.profileId),
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
            return !!(await queueExit(position, settings.executionDelaySeconds, "trailing_stop"));
          }
        }
      }
      return false;
    })
  );

  return results.filter(Boolean).length;
}
