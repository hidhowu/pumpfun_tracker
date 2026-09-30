import { Trader } from "../models/Trader.js";
import { Wallet } from "../models/Wallet.js";
import { WalletTrader } from "../models/WalletTrader.js";
import { WalletPosition } from "../models/WalletPosition.js";
import { WalletPendingExecution } from "../models/WalletPendingExecution.js";
import { estimateTradeUsdValue, sumTraderTokenAmount } from "./engine.js";

const CLOSING_OUT_FRACTION_PERCENT = 95; // same threshold as db/simulation/engine.js's evaluateSell

async function evaluateWalletBuy(wallet, walletTrader, trade) {
  if (walletTrader.everBoughtMints.includes(trade.mint)) return false; // permanent per-wallet-per-trader dup protection

  const alreadyPending = await WalletPendingExecution.exists({
    walletId: wallet._id,
    traderAddress: walletTrader.traderAddress,
    mint: trade.mint,
    action: "buy",
    status: "pending",
  });
  if (alreadyPending) return false;

  const tradeUsd = await estimateTradeUsdValue(trade);
  if (tradeUsd === null || tradeUsd < wallet.settings.dustBuyUsd) return false;

  const triggerAt = new Date(Date.now() + wallet.settings.executionDelaySeconds * 1000);
  try {
    await WalletPendingExecution.create({
      walletId: wallet._id,
      traderAddress: walletTrader.traderAddress,
      mint: trade.mint,
      action: "buy",
      triggerAt,
      sourceSignature: trade.signature,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err; // already queued by a concurrent call
    return false;
  }
  return true;
}

async function evaluateWalletSell(wallet, traderAddress, trade) {
  const openPosition = await WalletPosition.exists({ walletId: wallet._id, traderAddress, mint: trade.mint, status: "open" });
  if (!openPosition) return false; // this wallet doesn't hold this mint - ignore, same as the Profile-scoped path

  const alreadyPending = await WalletPendingExecution.exists({
    walletId: wallet._id,
    traderAddress,
    mint: trade.mint,
    action: "sell",
    status: "pending",
  });
  if (alreadyPending) return false;

  // Same dust-for-sell logic as db/simulation/engine.js's evaluateSell,
  // against the SAME shared (wallet-agnostic) Trade history - the real
  // trader's own on-chain sell fraction doesn't depend on which wallet is
  // watching, only wallet.settings.dustSellFractionPercent's threshold does.
  const traderBoughtTotal = await sumTraderTokenAmount(traderAddress, trade.mint, "buy");
  const traderSoldBefore = await sumTraderTokenAmount(traderAddress, trade.mint, "sell", { beforeBlockTime: trade.blockTime });

  const soldFraction = traderBoughtTotal > 0 ? (trade.tokenAmount / traderBoughtTotal) * 100 : 100;
  const cumulativeSoldFraction = traderBoughtTotal > 0 ? ((traderSoldBefore + trade.tokenAmount) / traderBoughtTotal) * 100 : 100;
  const isClosingOut = cumulativeSoldFraction >= CLOSING_OUT_FRACTION_PERCENT;
  const isDust = soldFraction < wallet.settings.dustSellFractionPercent && !isClosingOut;
  if (isDust) return false;

  const triggerAt = new Date(Date.now() + wallet.settings.executionDelaySeconds * 1000);
  try {
    await WalletPendingExecution.create({
      walletId: wallet._id,
      traderAddress,
      mint: trade.mint,
      action: "sell",
      triggerAt,
      sourceSignature: trade.signature,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return false;
  }
  return true;
}

/**
 * Wallet-scoped mirror of db/simulation/engine.js's evaluateRealTrade - call
 * this alongside (never instead of) evaluateRealTrade, right after a real
 * trade has been recorded. Evaluates the trade against every WALLET this
 * trader is currently assigned to (WalletTrader), each with its own flat
 * settings (no resolveTraderSettings merge - a wallet has one settings
 * object, not a per-trader override tier). Does NOT check balance here -
 * that's enforced atomically at execution time (see
 * db/simulation/walletExecutor.js's executeWalletBuy) so queueing stays
 * fast/simple, same division of responsibility as the Profile-scoped path.
 *
 * @returns {Promise<boolean>} true if at least one wallet acted on this trade.
 */
export async function evaluateWalletTrade(trade) {
  const trader = await Trader.findOne({ address: trade.wallet });
  if (!trader || trader.status !== "active") return false;

  const walletTraders = await WalletTrader.find({ traderAddress: trade.wallet });
  if (walletTraders.length === 0) return false;

  let actionedByAny = false;
  for (const walletTrader of walletTraders) {
    const wallet = await Wallet.findById(walletTrader.walletId);
    if (!wallet) continue; // stale membership row (wallet deleted) - db/walletService.js's deleteWallet cascades this away, but skip defensively either way

    const actioned =
      trade.type === "buy"
        ? await evaluateWalletBuy(wallet, walletTrader, trade)
        : await evaluateWalletSell(wallet, trade.wallet, trade);
    if (actioned) actionedByAny = true;
  }

  return actionedByAny;
}
