import { ApiTrade } from "../models/ApiTrade.js";

const TRADE_PURGE_MS = 48 * 60 * 60 * 1000;

/**
 * The ledger of the "api" tracking method: the trades of tracked traders as pump.fun's user-trades API reported them. The
 * counterpart of db/positionLedger.js (recordTrade / markTradeActioned / sumTraderTokenAmount), over ApiTrade instead of Trade, and
 * deliberately without the FIFO lots and trader statistics - those belong to the log pipeline and must not be counted twice.
 *
 * @param {object} trade a trade as db/simulation/apiTradePoller.js builds it: { signature, type, mint, wallet, tokenAmount, solAmount, amountUsd, blockTime }
 * @returns {Promise<boolean>} true if newly recorded, false if this exact trade was already there
 */
export async function recordApiTrade(trade) {
  try {
    await ApiTrade.create({
      traderAddress: trade.wallet,
      signature: trade.signature,
      type: trade.type,
      mint: trade.mint,
      tokenAmount: trade.tokenAmount,
      solAmount: trade.solAmount,
      amountUsd: trade.amountUsd,
      blockTime: trade.blockTime,
      purgeAt: new Date(Date.now() + TRADE_PURGE_MS),
    });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

/** A wallet acted on this trade: keep it past the 48h purge (a position needs the trader's history for as long as it is open). */
export async function markApiTradeActioned(trade) {
  await ApiTrade.updateOne(
    { traderAddress: trade.wallet, signature: trade.signature, mint: trade.mint, type: trade.type },
    { $set: { purgeAt: null } }
  );
}

/** Same as db/simulation/engine.js's sumTraderTokenAmount, over the API ledger. */
export async function sumApiTraderTokenAmount(traderAddress, mint, type, { beforeBlockTime } = {}) {
  const match = { traderAddress, mint, type };
  if (beforeBlockTime !== undefined) match.blockTime = { $lt: beforeBlockTime };
  const [row] = await ApiTrade.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: "$tokenAmount" } } }]);
  return row?.total || 0;
}
