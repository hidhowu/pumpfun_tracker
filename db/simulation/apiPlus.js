import { getSystemSettings } from "../models/SystemSettings.js";
import { sweepPhase } from "../backtest/simulator.js";
import { tokenTradesClient } from "./apiClients.js";
import { PRICE_SOURCES } from "../settingsLimits.js";

/**
 * The trade-list ("api") way of pricing, the default of the "api_plus" and "grpc" tracking methods (see priceSources below for the per-wallet choice):
 * every price - the buy fill, each stop-loss / take-profit / trailing-stop check, the sale fill - is read from the token's trade list, the way the
 * backtest does it (db/backtest/simulator.js), so a live run and a backtest of the same trade see the same prices at the same moments:
 *
 *   fill      = the pool price at Te - the pre-trade price of the first trade at or after Te (Te = the moment the buy is due)
 *   checks    = at Te + phase + k x interval, the pool price at THAT moment, and only those moments (a spike between two is never seen)
 *   exit      = decided at a check moment `at`, filled at the pool price at `at` + execution delay
 *
 * "The pool price at T" needs a trade at or after T to exist, so a moment is only judged once the API lists one (or, on a token that has gone
 * quiet, once QUIET_GRACE_SEC has passed - the pool is then unchanged from the last trade, as in the backtest's end of data).
 */

const INDEX_LAG_SEC = 2; // the API lists a trade a moment after it lands; a moment is not judged before that, or a trade still on its way could be missed
const QUIET_GRACE_SEC = 15; // no trade at or after the moment this long after it: the pool has not moved, use the last trade's price
const WINDOW_SEC = 30; // how far past the moment trades are read - only the first one is used

export { INDEX_LAG_SEC };

/**
 * Where a wallet's prices come from, one choice for each of the three moments a price is needed (Wallet.settings.buyPriceSource / checkPriceSource /
 * exitPriceSource):
 *   buy    the price a simulated buy fills at
 *   check  the price the stop-loss / take-profit / trailing-stop checks judge a position on
 *   exit   the price a sale (the trader's sell, or an exit this wallet decided) fills at
 * each one of
 *   "sdk"  pump.fun's / PumpSwap's SDK quote (db/simulation/sdkQuote.js): what the program would pay right now, fee and price impact included. Needs nothing
 *          to be tracked - any token on a curve or in a PumpSwap pool can be quoted at once.
 *   "api"  the token's own trade list (pump.fun's API, or the local gRPC tracking server when GRPC_TRACKER_URL is set): the pool price at the backtest's
 *          moments, so a live run and a backtest of the same trade agree. The server has to be following the token (it starts when a tracked wallet buys it
 *          or the app first asks for it).
 * A choice left unset follows the wallet's tracking method, which is how every wallet behaved before the choices existed: "api" -> the SDK throughout,
 * "api_plus" / "grpc" -> the trade list throughout. A "logs" wallet has no choice: it fills and checks at the spot price ("spot").
 */
const METHOD_DEFAULT_SOURCE = { api: "sdk", api_plus: "api", grpc: "api" };

/** @returns {{ buy: "sdk"|"api"|"spot", check: "sdk"|"api"|"spot", exit: "sdk"|"api"|"spot" }} */
export function priceSources(settings) {
  const fallback = METHOD_DEFAULT_SOURCE[settings?.trackingMethod ?? "logs"];
  if (!fallback) return { buy: "spot", check: "spot", exit: "spot" };
  const pick = (value) => (PRICE_SOURCES.includes(value) ? value : fallback);
  return { buy: pick(settings?.buyPriceSource), check: pick(settings?.checkPriceSource), exit: pick(settings?.exitPriceSource) };
}

/** The sweep interval a position gets, frozen at its open (the backtest freezes it per run). Never below 1 second. */
export async function apiPlusIntervalSeconds() {
  const settings = await getSystemSettings();
  return Math.max(1, Math.round(settings.riskCheckIntervalSeconds || 7));
}

/** The check schedule of a position that filled at `fillAtSec`: the same first moment the backtest picks for this trade. */
export function apiPlusSchedule({ mint, signature, fillAtSec, intervalSec }) {
  return { fillAtSec, intervalSec, nextSweepAtSec: fillAtSec + sweepPhase(`${mint}:${signature}`, intervalSec) };
}

/**
 * The pool price at `atSec`, read from the token's trades.
 * @param {{ nowSec?: number, force?: boolean }} [options] force = give the best answer there is now (a sale that has waited long enough) instead of waiting for a trade
 * @returns {Promise<{ priceUsd: number, source: "trade"|"prior_trade" } | null>} null = not known yet, ask again a little later
 */
export async function poolPriceAt(mint, atSec, { nowSec = Date.now() / 1000, force = false } = {}) {
  if (nowSec < atSec + INDEX_LAG_SEC && !force) return null;
  const { trades, prior } = await tokenTradesClient.fetchRange(mint, Math.floor(atSec), Math.ceil(Math.min(Math.max(nowSec, atSec), atSec + WINDOW_SEC)));
  const first = trades.find((t) => t.ts >= atSec);
  if (first && first.priceUsd > 0) return { priceUsd: first.priceUsd, source: "trade" };
  if (prior?.fillPriceUsd > 0 && (force || nowSec >= atSec + QUIET_GRACE_SEC)) return { priceUsd: prior.fillPriceUsd, source: "prior_trade" };
  return null;
}

/**
 * The first check moment of a schedule (anchored at `startSec`) after `afterSec` (null = none judged yet): the moment to judge next.
 * Whether it is old enough to be listed is the caller's to check (INDEX_LAG_SEC).
 */
export function nextSampleAt({ key, startSec, intervalSec, afterSec = null }) {
  return afterSec == null ? startSec + sweepPhase(key, intervalSec) : afterSec + intervalSec;
}
