import { Trader } from "../models/Trader.js";
import { Trade } from "../models/Trade.js";
import { Profile } from "../models/Profile.js";
import { SimPosition } from "../models/SimPosition.js";
import { PendingExecution } from "../models/PendingExecution.js";
import { resolveTraderSettings } from "../settings.js";
import { getPrice } from "../pumpFunApi.js";
import { ensureTraderInitialized } from "./init.js";

const CLOSING_OUT_FRACTION_PERCENT = 95;

/**
 * Estimates the USD value of a real on-chain trade using the mint's
 * *current* price. Used only for the dust-buy check - close enough for
 * "is this trade big enough to matter", and it avoids needing a historical
 * SOL/USD rate (which pump.fun's API doesn't give us for a past moment).
 * Shared across every profile (one price lookup, not one per profile) since
 * it only depends on the trade/mint, not on any profile's settings.
 */
export async function estimateTradeUsdValue(trade) {
  if (!trade.tokenAmount) return null;
  const price = await getPrice(trade.mint);
  if (!price?.priceUsd) return null;
  return trade.tokenAmount * price.priceUsd;
}

/**
 * Sums the tracked wallet's OWN real on-chain buy/sell volume for a mint -
 * queries the shared `Trade` collection, which is not profile-scoped (every
 * profile sees the exact same real trading history for a wallet; only the
 * *decision* of whether to act on it varies per profile).
 */
export async function sumTraderTokenAmount(traderAddress, mint, type, { beforeBlockTime } = {}) {
  const match = { traderAddress, mint, type };
  if (beforeBlockTime !== undefined) match.blockTime = { $lt: beforeBlockTime };
  const [row] = await Trade.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$tokenAmount" } } }]);
  return row?.total || 0;
}

async function evaluateBuy(profileId, profileTrader, trade, settings) {
  if (profileTrader.sim.everBoughtMints.includes(trade.mint)) return false; // permanent per-profile-per-trader dup protection

  const alreadyPending = await PendingExecution.exists({
    profileId,
    traderAddress: profileTrader.traderAddress,
    mint: trade.mint,
    action: "buy",
    status: "pending",
  });
  if (alreadyPending) return false;

  const tradeUsd = await estimateTradeUsdValue(trade);
  if (tradeUsd === null || tradeUsd < settings.dustBuyUsd) return false; // dust - keep watching for a qualifying buy

  const triggerAt = new Date(Date.now() + settings.executionDelaySeconds * 1000);
  try {
    await PendingExecution.create({
      profileId,
      traderAddress: profileTrader.traderAddress,
      mint: trade.mint,
      action: "buy",
      triggerAt,
      sourceSignature: trade.signature,
    });
  } catch (err) {
    // Unique index on (profileId, traderAddress, mint, action) where
    // status="pending" - a concurrent call already queued this exact buy
    // (the `.exists()` check above has a race window between two
    // processes; this index is the real guarantee). Nothing to do, it's
    // already queued.
    if (err?.code !== 11000) throw err;
    return false;
  }
  return true;
}

async function evaluateSell(profileId, traderAddress, trade, settings) {
  const openPosition = await SimPosition.exists({ profileId, traderAddress, mint: trade.mint, status: "open" });
  if (!openPosition) return false; // this profile doesn't hold this mint - ignore, per spec

  const alreadyPending = await PendingExecution.exists({
    profileId,
    traderAddress,
    mint: trade.mint,
    action: "sell",
    status: "pending",
  });
  if (alreadyPending) return false;

  // Dust-for-sell: compare this sell's *fraction of the trader's total
  // bought amount* - not its raw USD value - so a full exit at a crashed
  // price still counts as real (see README / the original spec on this).
  // This is computed from the SHARED Trade history, same for every profile.
  const traderBoughtTotal = await sumTraderTokenAmount(traderAddress, trade.mint, "buy");
  const traderSoldBefore = await sumTraderTokenAmount(traderAddress, trade.mint, "sell", { beforeBlockTime: trade.blockTime });

  const soldFraction = traderBoughtTotal > 0 ? (trade.tokenAmount / traderBoughtTotal) * 100 : 100;
  const cumulativeSoldFraction = traderBoughtTotal > 0 ? ((traderSoldBefore + trade.tokenAmount) / traderBoughtTotal) * 100 : 100;
  const isClosingOut = cumulativeSoldFraction >= CLOSING_OUT_FRACTION_PERCENT;
  const isDust = soldFraction < settings.dustSellFractionPercent && !isClosingOut;
  if (isDust) return false; // ignore this sell signal, keep our position open

  const triggerAt = new Date(Date.now() + settings.executionDelaySeconds * 1000);
  try {
    await PendingExecution.create({
      profileId,
      traderAddress,
      mint: trade.mint,
      action: "sell",
      triggerAt,
      sourceSignature: trade.signature,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err; // already queued by a concurrent call - fine
    return false;
  }
  return true;
}

/**
 * Call this right after a real trade (from extractPumpTrades) has been
 * recorded via db/positionLedger.js's recordTrade(). Evaluates the trade
 * independently against EVERY profile - each one has its own settings, its
 * own permanent per-mint dedup, its own open positions, so the same real
 * trade can be dust for one profile and a real signal for another. Queues a
 * simulated buy/sell per profile that decides to act (delayed by that
 * profile's executionDelaySeconds - see db/simulation/executor.js for the
 * part that actually fills it later).
 *
 * @returns {Promise<boolean>} true if AT LEAST ONE profile acted on this
 *   trade (the caller uses this to exempt the shared Trade row from the
 *   48h no-action purge - see db/positionLedger.js's markTradeActioned).
 */
export async function evaluateRealTrade(trade) {
  const trader = await Trader.findOne({ address: trade.wallet });
  if (!trader || trader.status !== "active") return false;

  const profiles = await Profile.find({}, { _id: 1 }).lean();
  let actionedByAny = false;

  for (const profile of profiles) {
    const profileTrader = await ensureTraderInitialized(profile._id, trade.wallet);
    const settings = await resolveTraderSettings(profile._id, trade.wallet, { profileTrader });

    const actioned =
      trade.type === "buy"
        ? await evaluateBuy(profile._id, profileTrader, trade, settings)
        : await evaluateSell(profile._id, trade.wallet, trade, settings);
    if (actioned) actionedByAny = true;
  }

  return actionedByAny;
}
