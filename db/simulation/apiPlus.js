import { getSystemSettings } from "../models/SystemSettings.js";
import { sweepPhase } from "../backtest/simulator.js";
import { tokenTradesClient } from "./apiClients.js";

/**
 * The "api_plus" tracking method (Wallet.settings.trackingMethod): trades are detected through pump.fun's user-trades API like "api", but every
 * price - the buy fill, each stop-loss / take-profit / trailing-stop check, the sale fill - is read from the token's trade list, the way the
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

export const isApiPlusWallet = (wallet) => wallet?.settings?.trackingMethod === "api_plus";

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

/** The newest check moment of a schedule that is old enough to judge (anchored at `startSec`), or null before the first. */
export function latestSampleAt({ key, startSec, intervalSec, nowSec }) {
  const first = startSec + sweepPhase(key, intervalSec);
  const last = nowSec - INDEX_LAG_SEC;
  if (last < first) return null;
  return first + Math.floor((last - first) / intervalSec) * intervalSec;
}
