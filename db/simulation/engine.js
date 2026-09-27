import { Trader } from "../models/Trader.js";
import { Trade } from "../models/Trade.js";
import { SimPosition } from "../models/SimPosition.js";
import { PendingExecution } from "../models/PendingExecution.js";
import { resolveTraderSettings } from "../settings.js";
import { getCoinInfo, priceFromCoinInfo } from "../pumpFunApi.js";
import { ensureTraderInitialized } from "./init.js";

const CLOSING_OUT_FRACTION_PERCENT = 95;

/**
 * Estimates the USD value of a real on-chain trade using the mint's
 * *current* price. Used only for the dust-buy check - close enough for
 * "is this trade big enough to matter", and it avoids needing a historical
 * SOL/USD rate (which pump.fun's API doesn't give us for a past moment).
 */
async function estimateTradeUsdValue(trade) {
  if (!trade.tokenAmount) return null;
  const coin = await getCoinInfo(trade.mint).catch(() => null);
  const price = priceFromCoinInfo(coin);
  if (!price?.priceUsd) return null;
  return trade.tokenAmount * price.priceUsd;
}

async function sumTraderTokenAmount(traderAddress, mint, type, { beforeBlockTime } = {}) {
  const match = { traderAddress, mint, type };
  if (beforeBlockTime !== undefined) match.blockTime = { $lt: beforeBlockTime };
  const [row] = await Trade.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$tokenAmount" } } }]);
  return row?.total || 0;
}

async function evaluateBuy(trader, trade, settings) {
  if (trader.sim.everBoughtMints.includes(trade.mint)) return; // permanent per-trader dup protection

  const alreadyPending = await PendingExecution.exists({
    traderAddress: trader.address,
    mint: trade.mint,
    action: "buy",
    status: "pending",
  });
  if (alreadyPending) return;

  const tradeUsd = await estimateTradeUsdValue(trade);
  if (tradeUsd === null || tradeUsd < settings.dustBuyUsd) return; // dust - keep watching for a qualifying buy

  const triggerAt = new Date(Date.now() + settings.executionDelaySeconds * 1000);
  try {
    await PendingExecution.create({
      traderAddress: trader.address,
      mint: trade.mint,
      action: "buy",
      triggerAt,
      sourceSignature: trade.signature,
    });
  } catch (err) {
    // Unique index on (traderAddress, mint, action) where status="pending" -
    // a concurrent call already queued this exact buy (the `.exists()` check
    // above has a race window between two processes; this index is the real
    // guarantee). Nothing to do, it's already queued.
    if (err?.code !== 11000) throw err;
  }
}

async function evaluateSell(trader, trade, settings) {
  const openPosition = await SimPosition.exists({ traderAddress: trader.address, mint: trade.mint, status: "open" });
  if (!openPosition) return; // we don't hold this mint - ignore, per spec

  const alreadyPending = await PendingExecution.exists({
    traderAddress: trader.address,
    mint: trade.mint,
    action: "sell",
    status: "pending",
  });
  if (alreadyPending) return;

  // Dust-for-sell: compare this sell's *fraction of the trader's total
  // bought amount* - not its raw USD value - so a full exit at a crashed
  // price still counts as real (see README / the original spec on this).
  const traderBoughtTotal = await sumTraderTokenAmount(trader.address, trade.mint, "buy");
  const traderSoldBefore = await sumTraderTokenAmount(trader.address, trade.mint, "sell", { beforeBlockTime: trade.blockTime });

  const soldFraction = traderBoughtTotal > 0 ? (trade.tokenAmount / traderBoughtTotal) * 100 : 100;
  const cumulativeSoldFraction = traderBoughtTotal > 0 ? ((traderSoldBefore + trade.tokenAmount) / traderBoughtTotal) * 100 : 100;
  const isClosingOut = cumulativeSoldFraction >= CLOSING_OUT_FRACTION_PERCENT;
  const isDust = soldFraction < settings.dustSellFractionPercent && !isClosingOut;
  if (isDust) return; // ignore this sell signal, keep our position open

  const triggerAt = new Date(Date.now() + settings.executionDelaySeconds * 1000);
  try {
    await PendingExecution.create({
      traderAddress: trader.address,
      mint: trade.mint,
      action: "sell",
      triggerAt,
      sourceSignature: trade.signature,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err; // already queued by a concurrent call - fine
  }
}

/**
 * Call this right after a real trade (from extractPumpTrades) has been
 * recorded via db/positionLedger.js's recordTrade(). Decides whether it
 * should trigger a simulated copy-trade, and if so, queues it (delayed by
 * the trader's executionDelaySeconds - see db/simulation/executor.js for
 * the part that actually fills it later).
 */
export async function evaluateRealTrade(trade) {
  const trader = await Trader.findOne({ address: trade.wallet });
  if (!trader || trader.status !== "active") return;

  const initialized = await ensureTraderInitialized(trader);
  const settings = await resolveTraderSettings(initialized);

  if (trade.type === "buy") await evaluateBuy(initialized, trade, settings);
  else await evaluateSell(initialized, trade, settings);
}
