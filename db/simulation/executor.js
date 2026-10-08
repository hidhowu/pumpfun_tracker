import { Trader } from "../models/Trader.js";
import { ProfileTrader } from "../models/ProfileTrader.js";
import { SimPosition } from "../models/SimPosition.js";
import { PendingExecution } from "../models/PendingExecution.js";
import { NegativeBalanceEvent } from "../models/NegativeBalanceEvent.js";
import { resolveTraderSettings } from "../settings.js";
import { getPrice, prefetchPrices, PRICE_MAX_AGE } from "../pumpFunApi.js";
import { logEvent } from "../systemLog.js";
import { computeTradeFees, realizedCounterDeltaOnClose } from "../fees.js";

async function markSkipped(pending, reason) {
  pending.status = "skipped";
  pending.skipReason = reason;
  pending.processedAt = new Date();
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
  pending.triggerAt = new Date(Date.now() + 1000 * pending.attempts);
  await pending.save();
}

async function markDone(pending) {
  pending.status = "done";
  pending.processedAt = new Date();
  await pending.save();
}

/** Unrealized $ / % for a position given its current token value (tokenAmount * price) and its fixed cost basis. */
function computeUnrealized(currentValueUsd, totalCost) {
  const unrealizedUsd = currentValueUsd - totalCost;
  const unrealizedPercent = totalCost > 0 ? (unrealizedUsd / totalCost) * 100 : 0;
  return { unrealizedUsd, unrealizedPercent };
}

/** Mutates one profile's simulated balance for one trader - `profileTrader` must be a hydrated ProfileTrader document. */
async function applyBalanceDelta(profileTrader, deltaUsd) {
  const newBalance = profileTrader.sim.balanceUsd + deltaUsd;
  const inc = { "sim.balanceUsd": deltaUsd };
  const set = {};
  if (newBalance < 0) {
    // Existing lifetime counters - unchanged.
    inc["sim.negativeBalanceEventCount"] = 1;
    if (Math.abs(newBalance) > profileTrader.sim.maxNegativeBalanceUsd) {
      set["sim.maxNegativeBalanceUsd"] = Math.abs(newBalance);
    }
  }
  await ProfileTrader.updateOne({ _id: profileTrader._id }, { $inc: inc, ...(Object.keys(set).length ? { $set: set } : {}) });

  if (newBalance < 0) {
    // Additive: a timestamped record of this specific crossing, so
    // day-by-day stats (count + deepest point *for that day*) can be
    // computed - the lifetime counters above can't answer that on their own.
    await NegativeBalanceEvent.create({
      profileId: profileTrader.profileId,
      traderAddress: profileTrader.traderAddress,
      balanceUsd: newBalance,
      depthUsd: Math.abs(newBalance),
    });
  }

  return newBalance;
}

async function executeBuy(pending) {
  const trader = await Trader.findOne({ address: pending.traderAddress });
  if (!trader || trader.status !== "active") return markSkipped(pending, "trader inactive or blacklisted");

  const profileTrader = await ProfileTrader.findOne({ profileId: pending.profileId, traderAddress: pending.traderAddress });
  if (!profileTrader) return markSkipped(pending, "profile/trader state missing (race)");
  if (profileTrader.sim.everBoughtMints.includes(pending.mint)) return markSkipped(pending, "already bought this mint (race)");

  const existingOpen = await SimPosition.exists({ profileId: pending.profileId, traderAddress: trader.address, mint: pending.mint, status: "open" });
  if (existingOpen) return markSkipped(pending, "position already open (race)");

  const settings = await resolveTraderSettings(pending.profileId, trader.address, { profileTrader });
  const spendUsd = settings.tradeSizeUsd;
  const buyFees = computeTradeFees(spendUsd, settings);
  const feeUsd = buyFees.totalFeeUsd;
  if (!settings.allowNegativeBalance && profileTrader.sim.balanceUsd < spendUsd + feeUsd) {
    return markSkipped(pending, "insufficient balance and negative balance is disabled for this trader");
  }

  const price = await getPrice(pending.mint, { fresh: true });
  if (!price?.priceUsd) return retryWithoutPrice(pending);

  const tokenAmount = spendUsd / price.priceUsd;
  // At t=0 the position is worth exactly what was spent on it (that's the
  // definition of costBasisUsd) - the fee is a separate, already-realized
  // cost, so the very first "unrealized" reading is -feeUsd, not 0. This is
  // also the starting point the peak-tracker (maxValueUsd) grows from.
  const initialUnrealized = computeUnrealized(spendUsd, spendUsd + feeUsd);

  try {
    await SimPosition.create({
      profileId: pending.profileId,
      traderAddress: trader.address,
      mint: pending.mint,
      status: "open",
      tokenAmount,
      costBasisUsd: spendUsd,
      buyFeeUsd: feeUsd,
      buyPumpFeeUsd: buyFees.pumpFeeUsd,
      buyJitoFeeUsd: buyFees.jitoFeeUsd,
      buyFeeRealizedAtOpen: true,
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
    // Unique index on (profileId, traderAddress, mint) where status="open" -
    // a concurrent executor pass already opened this position first.
    // Balance hasn't been touched yet at this point, so there's nothing to undo.
    if (err?.code === 11000) return markSkipped(pending, "position already open (lost the race)");
    throw err;
  }

  await applyBalanceDelta(profileTrader, -(spendUsd + feeUsd));
  await ProfileTrader.updateOne(
    { _id: profileTrader._id },
    {
      // The buy fee is money already gone - it hits realized P&L now, not
      // only once the position closes (see db/fees.js).
      $inc: { "sim.openPositionCount": 1, "sim.realizedPnlUsd": -feeUsd },
      $addToSet: { "sim.everBoughtMints": pending.mint },
      $set: { "sim.lastActionAt": new Date() },
    }
  );

  await markDone(pending);
  logEvent("trade", `Bought ${pending.mint} for ${trader.address}: $${spendUsd.toFixed(2)} + $${feeUsd.toFixed(2)} fees @ $${price.priceUsd}`, {
    meta: { profileId: String(pending.profileId), traderAddress: trader.address, mint: pending.mint, spendUsd, feeUsd, priceUsd: price.priceUsd },
  });
}

/**
 * Closes a position - or does nothing if it's already closed. This MUST be
 * safe to call concurrently: `executeSell` (every ~2s, mirroring the
 * trader's own sell) and `checkRiskExits` (every ~20s, stop-loss/take-
 * profit/trailing-stop) both operate on open positions independently, and
 * can both decide to close the very same position around the same time. The
 * guard against double-closing is the `findOneAndUpdate` below with
 * `status: "open"` in the filter: only the call that actually flips it from
 * "open" to "closed" gets a non-null result back and proceeds to touch the
 * balance/counters. A plain read-then-.save() (what this used to do) is NOT
 * sufficient - both callers can read the same still-"open" document before
 * either writes, and both would then apply the balance/counter change,
 * corrupting them (this is exactly what caused negative openPositionCount
 * and doubled balance changes in production).
 */
async function closePosition(positionId, { priceUsd, fees, closeReason, closeSignature }) {
  const position = await SimPosition.findOne({ _id: positionId, status: "open" });
  if (!position) return null; // already closed by a concurrent call - nothing to do

  const proceedsUsd = position.tokenAmount * priceUsd;
  const sellFees = computeTradeFees(proceedsUsd, fees);
  const feeUsd = sellFees.totalFeeUsd;
  const totalCost = position.costBasisUsd + position.buyFeeUsd;
  const netProceeds = proceedsUsd - feeUsd;
  const realizedPnlUsd = netProceeds - totalCost;
  const realizedPnlPercent = totalCost > 0 ? (realizedPnlUsd / totalCost) * 100 : 0;

  // The closing price is one more price sample - fold it into the peak
  // tracker before finalizing, in case this position closed at (or above)
  // its highest point and the periodic risk-check never happened to sample
  // that exact moment (e.g. a short-lived position, or the trader sold
  // between two risk-check ticks).
  const closeUnrealized = computeUnrealized(proceedsUsd, totalCost);
  const peakIsNow = proceedsUsd > position.maxValueUsd;
  const troughIsNow = position.minValueUsd === null || proceedsUsd < position.minValueUsd;

  const updated = await SimPosition.findOneAndUpdate(
    { _id: positionId, status: "open" }, // the actual race guard - see comment above
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        closeReason,
        closeTriggerSignature: closeSignature,
        sellPriceUsd: priceUsd,
        proceedsUsd,
        sellFeeUsd: feeUsd,
        sellPumpFeeUsd: sellFees.pumpFeeUsd,
        sellJitoFeeUsd: sellFees.jitoFeeUsd,
        realizedPnlUsd,
        realizedPnlPercent,
        ...(peakIsNow
          ? {
              maxValueUsd: proceedsUsd,
              maxUnrealizedPnlUsd: closeUnrealized.unrealizedUsd,
              maxUnrealizedPnlPercent: closeUnrealized.unrealizedPercent,
            }
          : {}),
        ...(troughIsNow
          ? {
              minValueUsd: proceedsUsd,
              minUnrealizedPnlUsd: closeUnrealized.unrealizedUsd,
              minUnrealizedPnlPercent: closeUnrealized.unrealizedPercent,
            }
          : {}),
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) return null; // lost the race between the read above and this write

  const profileTrader = await ProfileTrader.findOne({ profileId: updated.profileId, traderAddress: updated.traderAddress });
  await applyBalanceDelta(profileTrader, netProceeds);
  await ProfileTrader.updateOne(
    { _id: profileTrader._id },
    {
      $inc: {
        "sim.openPositionCount": -1,
        "sim.closedPositionCount": 1,
        "sim.realizedPnlUsd": realizedCounterDeltaOnClose(updated, realizedPnlUsd),
      },
      $set: { "sim.lastActionAt": new Date() },
    }
  );

  logEvent(
    "trade",
    `Closed ${updated.mint} for ${updated.traderAddress}: ${closeReason} pnl=$${realizedPnlUsd.toFixed(2)} (${realizedPnlPercent.toFixed(1)}%)`,
    { meta: { profileId: String(updated.profileId), traderAddress: updated.traderAddress, mint: updated.mint, closeReason, realizedPnlUsd, realizedPnlPercent } }
  );

  return updated;
}

async function executeSell(pending) {
  const trader = await Trader.findOne({ address: pending.traderAddress });
  if (!trader) return markSkipped(pending, "trader not found");

  const position = await SimPosition.findOne({ profileId: pending.profileId, traderAddress: pending.traderAddress, mint: pending.mint, status: "open" });
  if (!position) return markSkipped(pending, "no open position (race - already closed)");

  const settings = await resolveTraderSettings(pending.profileId, pending.traderAddress);
  const price = await getPrice(pending.mint, { fresh: true });
  if (!price?.priceUsd) return retryWithoutPrice(pending);

  await closePosition(position._id, {
    priceUsd: price.priceUsd,
    fees: settings,
    closeReason: pending.closeReason || "trader_sell",
    closeSignature: pending.closeReason && pending.closeReason !== "trader_sell" ? null : pending.sourceSignature,
  });

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
 * atomically claimed (pending -> processing) via findOneAndUpdate before
 * it's acted on, so an overlapping run (e.g. a slow price lookup causing
 * one interval tick to still be running when the next one fires) can never
 * process the same item twice.
 */
export async function processDuePendingExecutions() {
  const due = await PendingExecution.find({ status: "pending", triggerAt: { $lte: new Date() } }).limit(50);
  let processed = 0;
  for (const item of due) {
    const claimed = await PendingExecution.findOneAndUpdate(
      { _id: item._id, status: "pending" },
      { $set: { status: "processing" } },
      { returnDocument: "after" }
    );
    if (!claimed) continue; // another (overlapping) run already claimed this one
    try {
      if (claimed.action === "buy") await executeBuy(claimed);
      else await executeSell(claimed);
      processed += 1;
    } catch (err) {
      await markSkipped(claimed, err.message);
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
