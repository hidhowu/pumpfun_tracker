import { logEvent } from "../systemLog.js";
import { recordApiTrade, markApiTradeActioned } from "./apiLedger.js";
import { evaluateWalletTrade } from "./walletEngine.js";
import { trackTokenInBackground } from "../grpc/client.js";

/**
 * A trade is first seen older than this: a buy is skipped (copying it now wouldn't be a faithful copy). A SELL seen late is still acted on - missing it
 * would leave a position open.
 */
export const FRESH_BUY_SECONDS = 30;

/**
 * One trade of a tracked trader that a feed reported - the user-trades poller (db/simulation/apiTradePoller.js) or the gRPC tracking server's
 * webhook (db/grpc/receiver.js) - recorded in the API ledger and evaluated by the wallets that follow the trader that way.
 *
 * @param {string} address the trader
 * @param {{ tx: string, isBuy: boolean, ts: number, mint: string, amountSol: number|null, amountUsd: number|null, tokenAmount: number|null }} t a row as normalizeUserTrade makes it
 * @param {{ trackingMethod: "api"|"grpc", onError?: (err: Error) => void, rethrow?: boolean }} options which wallets take part (see evaluateWalletTrade);
 *   rethrow = pass a failure on to the caller after logging it (the webhook answers 500 so the server sends the trade again - nothing re-reads it otherwise)
 */
export async function handleDetectedTrade(address, t, { trackingMethod, onError = () => {}, rethrow = false }) {
  const trade = {
    signature: t.tx,
    slot: null,
    blockTime: t.ts,
    type: t.isBuy ? "buy" : "sell",
    program: null,
    mint: t.mint,
    wallet: address,
    tokenAmount: t.tokenAmount,
    solAmount: t.amountSol,
    amountUsd: t.amountUsd,
    solAmountSource: "api", // both feeds report the amounts the way the user-trades API does, and are kept in the same ledger
    isNativeSolQuote: true,
    quoteMint: null,
    source: "api",
    detectedAt: Date.now(),
  };
  // The buy check and every price afterwards are read from the tracking server (when it is set): ask it to follow the token at once.
  if (t.isBuy) trackTokenInBackground(t.mint, onError);
  try {
    await recordApiTrade(trade);
    // A trade already recorded (a restart re-reads the last seconds, a webhook is retried) is evaluated again on purpose: the queue's own idempotency
    // keys make that harmless, and it is what recovers a trade the previous run saw but died before acting on.
    if (await evaluateWalletTrade(trade, { trackingMethod })) await markApiTradeActioned(trade);
  } catch (err) {
    onError(err);
    logEvent("tracker", `Failed to evaluate ${trackingMethod} trade ${trade.signature} for ${address}: ${err.message}`, { level: "error", meta: { address, signature: trade.signature } });
    if (rethrow) throw err;
  }
}
