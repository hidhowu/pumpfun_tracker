import { Trader } from "./models/Trader.js";
import { Trade } from "./models/Trade.js";
import { PositionLot } from "./models/PositionLot.js";

const EPSILON = 1e-9;

/**
 * Records a trade (from extractPumpTrades) against a trader: stores the
 * Trade row, maintains FIFO PositionLots for that mint, and updates the
 * trader's cached stats (trade/volume counts, realized PnL, win rate).
 *
 * Buys open a new lot. Sells consume the oldest open lots first (FIFO) up
 * to however much of the sale we can actually match to a known cost basis
 * - if a trader sells more than we ever saw them buy (e.g. they already
 * held the token before we started tracking them), the unmatched portion
 * is left out of the PnL calculation rather than guessing a cost basis.
 *
 * Safe to call more than once for the same trade - the underlying Trade
 * document has a unique index on (traderAddress, signature, mint, type),
 * so a duplicate call throws a duplicate-key error and this function
 * returns without touching any stats twice.
 *
 * @param {object} trade - a record from extractPumpTrades(), e.g.
 *   { signature, type, mint, wallet, tokenAmount, solAmount, slot, blockTime }
 * @returns {Promise<boolean>} true if newly recorded, false if it was a duplicate
 */
export async function recordTrade(trade) {
  const traderAddress = trade.wallet;

  try {
    await Trade.create({
      traderAddress,
      signature: trade.signature,
      type: trade.type,
      program: trade.program,
      mint: trade.mint,
      tokenAmount: trade.tokenAmount,
      solAmount: trade.solAmount,
      solAmountSource: trade.solAmountSource,
      isNativeSolQuote: trade.isNativeSolQuote,
      quoteMint: trade.quoteMint,
      slot: trade.slot,
      blockTime: trade.blockTime,
    });
  } catch (err) {
    if (err?.code === 11000) return false; // already recorded this exact leg
    throw err;
  }

  const lastTradeAt = trade.blockTime ? new Date(trade.blockTime * 1000) : new Date();

  if (trade.type === "buy") {
    if (trade.tokenAmount > 0) {
      await PositionLot.create({
        traderAddress,
        mint: trade.mint,
        tokenAmountRemaining: trade.tokenAmount,
        solCostRemaining: trade.solAmount || 0,
        openSignature: trade.signature,
      });
    }
    await Trader.updateOne(
      { address: traderAddress },
      {
        $inc: { "stats.tradeCount": 1, "stats.buyCount": 1, "stats.totalSolVolume": trade.solAmount || 0 },
        $set: { "stats.lastTradeAt": lastTradeAt },
      }
    );
    return true;
  }

  // sell: consume FIFO lots for this mint
  const soldTokenAmount = trade.tokenAmount || 0;
  let remainingToMatch = soldTokenAmount;
  let costBasisMatched = 0;
  let matchedTokenAmount = 0;

  if (soldTokenAmount > EPSILON) {
    const lots = await PositionLot.find({ traderAddress, mint: trade.mint }).sort({ openedAt: 1 });
    for (const lot of lots) {
      if (remainingToMatch <= EPSILON) break;
      const take = Math.min(lot.tokenAmountRemaining, remainingToMatch);
      const proportion = take / lot.tokenAmountRemaining;
      const costForTake = lot.solCostRemaining * proportion;

      costBasisMatched += costForTake;
      matchedTokenAmount += take;
      remainingToMatch -= take;

      const newRemaining = lot.tokenAmountRemaining - take;
      if (newRemaining <= EPSILON) {
        await PositionLot.deleteOne({ _id: lot._id });
      } else {
        await PositionLot.updateOne(
          { _id: lot._id },
          { $set: { tokenAmountRemaining: newRemaining, solCostRemaining: lot.solCostRemaining - costForTake } }
        );
      }
    }
  }

  const proceedsMatched = soldTokenAmount > EPSILON ? (trade.solAmount || 0) * (matchedTokenAmount / soldTokenAmount) : 0;
  const realizedPnl = matchedTokenAmount > EPSILON ? proceedsMatched - costBasisMatched : 0;

  const statsInc = {
    "stats.tradeCount": 1,
    "stats.sellCount": 1,
    "stats.totalSolVolume": trade.solAmount || 0,
    "stats.realizedPnlSol": realizedPnl,
  };
  if (matchedTokenAmount > EPSILON) {
    if (realizedPnl > EPSILON) statsInc["stats.wins"] = 1;
    else if (realizedPnl < -EPSILON) statsInc["stats.losses"] = 1;
  }

  await Trader.updateOne({ address: traderAddress }, { $inc: statsInc, $set: { "stats.lastTradeAt": lastTradeAt } });
  return true;
}

/**
 * Current holdings for a trader: remaining token amount + cost basis per
 * mint, aggregated across all their open PositionLots. Mark-to-market USD
 * value is left to the caller (needs a live price lookup per mint).
 */
export async function getHoldings(traderAddress) {
  const rows = await PositionLot.aggregate([
    { $match: { traderAddress } },
    {
      $group: {
        _id: "$mint",
        tokenAmount: { $sum: "$tokenAmountRemaining" },
        solCostBasis: { $sum: "$solCostRemaining" },
      },
    },
  ]);
  return rows
    .filter((r) => r.tokenAmount > EPSILON)
    .map((r) => ({ mint: r._id, tokenAmount: r.tokenAmount, solCostBasis: r.solCostBasis }));
}
