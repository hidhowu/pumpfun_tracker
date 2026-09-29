import { Trader } from "../models/Trader.js";
import { ProfileTrader } from "../models/ProfileTrader.js";
import { SimPosition } from "../models/SimPosition.js";
import { PendingExecution } from "../models/PendingExecution.js";
import { NegativeBalanceEvent } from "../models/NegativeBalanceEvent.js";
import { resolveTraderSettings } from "../settings.js";
import { getCoinInfo, priceFromCoinInfo } from "../pumpFunApi.js";
import { logEvent } from "../systemLog.js";

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
  if (!settings.allowNegativeBalance && profileTrader.sim.balanceUsd < settings.tradeSizeUsd) {
    return markSkipped(pending, "insufficient balance and negative balance is disabled for this trader");
  }

  const coin = await getCoinInfo(pending.mint).catch(() => null);
  const price = priceFromCoinInfo(coin);
  if (!price?.priceUsd) return markSkipped(pending, "no current price available for this mint");

  const spendUsd = settings.tradeSizeUsd;
  const feeUsd = settings.feeUsd;
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
      buyPriceUsd: price.priceUsd,
      openTriggerSignature: pending.sourceSignature,
      maxValueUsd: spendUsd,
      maxUnrealizedPnlUsd: initialUnrealized.unrealizedUsd,
      maxUnrealizedPnlPercent: initialUnrealized.unrealizedPercent,
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
      $inc: { "sim.openPositionCount": 1 },
      $addToSet: { "sim.everBoughtMints": pending.mint },
      $set: { "sim.lastActionAt": new Date() },
    }
  );

  await markDone(pending);
  logEvent("trade", `Bought ${pending.mint} for ${trader.address}: $${spendUsd.toFixed(2)} @ $${price.priceUsd}`, {
    meta: { profileId: String(pending.profileId), traderAddress: trader.address, mint: pending.mint, spendUsd, priceUsd: price.priceUsd },
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
async function closePosition(positionId, { priceUsd, feeUsd, closeReason, closeSignature }) {
  const position = await SimPosition.findOne({ _id: positionId, status: "open" });
  if (!position) return null; // already closed by a concurrent call - nothing to do

  const proceedsUsd = position.tokenAmount * priceUsd;
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
        realizedPnlUsd,
        realizedPnlPercent,
        ...(peakIsNow
          ? {
              maxValueUsd: proceedsUsd,
              maxUnrealizedPnlUsd: closeUnrealized.unrealizedUsd,
              maxUnrealizedPnlPercent: closeUnrealized.unrealizedPercent,
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
      $inc: { "sim.openPositionCount": -1, "sim.closedPositionCount": 1, "sim.realizedPnlUsd": realizedPnlUsd },
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
  const coin = await getCoinInfo(pending.mint).catch(() => null);
  const price = priceFromCoinInfo(coin);
  if (!price?.priceUsd) return markSkipped(pending, "no current price available for this mint");

  await closePosition(position._id, {
    priceUsd: price.priceUsd,
    feeUsd: settings.feeUsd,
    closeReason: "trader_sell",
    closeSignature: pending.sourceSignature,
  });

  await markDone(pending);
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
 * Not a latency-sensitive mirror of someone else's action, so no execution
 * delay is applied here.
 */
export async function checkRiskExits() {
  const openPositions = await SimPosition.find({ status: "open" });
  let closedCount = 0;

  const traderCache = new Map();
  const settingsCache = new Map(); // `${profileId}:${traderAddress}` -> {profileTrader, settings}
  for (const position of openPositions) {
    let trader = traderCache.get(position.traderAddress);
    if (trader === undefined) {
      trader = await Trader.findOne({ address: position.traderAddress });
      traderCache.set(position.traderAddress, trader ?? null);
    }
    if (!trader) continue;

    const coin = await getCoinInfo(position.mint).catch(() => null);
    const price = priceFromCoinInfo(coin);
    if (!price?.priceUsd) continue;

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
    if (!hasStopLoss && !hasTakeProfit && !hasMaxHoldTime && trailingStops.length === 0) continue;

    if (hasStopLoss && unrealizedPercent <= -Math.abs(settings.stopLossPercent)) {
      const closed = await closePosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "stop_loss", closeSignature: null });
      if (closed) closedCount += 1;
      continue;
    }

    if (hasTakeProfit && unrealizedPercent >= Math.abs(settings.takeProfitPercent)) {
      const closed = await closePosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "take_profit", closeSignature: null });
      if (closed) closedCount += 1;
      continue;
    }

    if (hasMaxHoldTime) {
      const elapsedSeconds = (Date.now() - position.openedAt.getTime()) / 1000;
      if (elapsedSeconds >= settings.maxTradeTimeSeconds) {
        const closed = await closePosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "max_hold_time", closeSignature: null });
        if (closed) closedCount += 1;
        continue;
      }
    }

    if (trailingStops.length > 0) {
      const armedIds = new Set(position.armedTrailingStopIds.map(String));
      let closedByTrailingStop = false;
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
          const closed = await closePosition(position._id, { priceUsd: price.priceUsd, feeUsd: settings.feeUsd, closeReason: "trailing_stop", closeSignature: null });
          if (closed) closedCount += 1;
          closedByTrailingStop = true;
          break; // one close is enough - stop evaluating this position's other rules
        }
      }
      if (closedByTrailingStop) continue;
    }
  }
  return closedCount;
}
