import { PumpTradesClient } from "../backtest/pumpTradesClient.js";

/**
 * The pump.fun HTTP clients of the "api" tracking method (Wallet.settings.trackingMethod). They are the same proxy-pooled, rate-paced
 * client the backtest uses (db/backtest/pumpTradesClient.js: round-robin over the proxy pool, a 429 cools only the proxy that got it,
 * never a direct connection while proxies exist), and read the same proxy list - so adding proxies on /proxies speeds this up too.
 *
 * Two instances so the pacing matches the endpoint: the user-trades endpoint (polled constantly) tolerates far more than the
 * token-trades one (asked once per buy).
 */
export const userTradesClient = new PumpTradesClient({ rpsSetting: "userTradesRps" });
export const tokenTradesClient = new PumpTradesClient({ rpsSetting: "proxyRps" });

// The last check before a buy: https://frontend-api-v3.pump.fun/trades/solana%3A5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/<mint>?limit=1&minUsd=1 must
// return at least one trade. Only existence matters, so one row is asked for instead of a hundred, and a trade under $1 doesn't count as a market.
// (The old swap-api.pump.fun/v2/coins/<mint>/trades answers 410 Gone since 2026-10-28, which skipped every API-wallet buy.)
const TOKEN_TRADES_MIN_USD = 1;

/**
 * Does this token have at least one real trade on pump.fun? false means the API answered with an empty list (the buy is skipped);
 * a network or API failure THROWS instead, so the caller retries rather than mistaking an outage for an empty token.
 */
export async function tokenHasTrades(mint) {
  const trades = await tokenTradesClient.fetchRecentTokenTrades(mint, { limit: 1, minUsd: TOKEN_TRADES_MIN_USD });
  return trades.length > 0;
}
