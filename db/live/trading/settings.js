/**
 * What a live wallet's trading settings mean in practice, in one place. A wallet made before a setting existed has no value for it (and a `.lean()`
 * read never fills defaults in), so every reader goes through here.
 *
 *  - trade size:  the simulation wallet's trade size x  tradeRatioLive / tradeRatioSim.
 *  - Jito mode:   a real tip. jitoTipUsd (the wallet's own Jito fee, used exactly as entered), or the simulation wallet's Jito fee when none is set.
 *  - raw mode:    no tip is paid. A Jito fee is still ASSUMED as a cost of the trade (never spent), so the live percentages can be compared with the
 *                 simulation's, which always pays it:
 *                   - the wallet's own Jito fee (jitoTipUsd) if one is set - exactly as entered, never scaled;
 *                   - otherwise the simulation's Jito fee. With scaling on (scaleJitoFee) it shrinks with a smaller trade (a $1 trade against a $10
 *                     simulation assumes a tenth of the fee) but NEVER grows past the simulation's fee (a $20 trade does not assume double);
 *                     with scaling off it is the simulation's fee at any trade size.
 */

export const RATIO_MIN = 0.001;
export const RATIO_MAX = 100_000;
export const MAX_TIP_USD = 1;
export const MAX_PRIORITY_MICRO_LAMPORTS = 200_000;
export const DEFAULT_PRIORITY_MICRO_LAMPORTS = 1000;

export const BASE_FEE_LAMPORTS = 5000;

/** The longest wait before a trade is built: a buy is given up 45 seconds after the trader's (db/live/trading/executor.js), so the wait must leave room for it. */
export const MAX_TRADE_DELAY_SECONDS = 30;

const finite = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The Jito fee assumed per transaction in raw mode (see the top of this file). Also used for a sell, with the scale its lot was bought at. */
export function assumedJitoFeeUsd({ ownFeeUsd, simFeeUsd, scale, scaling }) {
  if (ownFeeUsd != null) return ownFeeUsd;
  return scaling ? simFeeUsd * Math.min(1, scale) : simFeeUsd;
}

/** The wallet's wait before a trade, in seconds (0 for a wallet made before the setting existed). */
export function tradeDelaySeconds(live) {
  const value = finite(live?.tradeDelaySeconds, 0);
  return Math.min(MAX_TRADE_DELAY_SECONDS, Math.max(0, value));
}

/** @param {object} live a LiveWallet (lean or not) @param {object} sim the connected simulation Wallet */
export function tradingSettings(live, sim) {
  const sendMode = live.sendMode === "raw" ? "raw" : "jito";
  const ratioSim = finite(live.tradeRatioSim, 1) > 0 ? finite(live.tradeRatioSim, 1) : 1;
  const ratioLive = finite(live.tradeRatioLive, 1) > 0 ? finite(live.tradeRatioLive, 1) : 1;
  const scale = ratioLive / ratioSim;
  const simJitoUsd = Math.max(0, finite(sim?.settings?.jitoFeeUsd, 0));
  const configuredTip = live.jitoTipUsd == null ? null : Math.max(0, finite(live.jitoTipUsd, 0));
  return {
    sendMode,
    ratioSim,
    ratioLive,
    scale,
    paused: !!live.paused,
    /** Seconds to wait after the simulation's decision before the trade is priced and built. */
    delaySeconds: tradeDelaySeconds(live),
    priorityMicroLamports: Math.max(0, Math.floor(finite(live.rawPriorityMicroLamports, DEFAULT_PRIORITY_MICRO_LAMPORTS))),
    /** Dollars of Jito tip actually paid per transaction (0 in raw mode). */
    tipUsd: sendMode === "jito" ? (configuredTip ?? simJitoUsd) : 0,
    scaleJitoFee: live.scaleJitoFee !== false,
    /** Dollars of Jito fee that count as a cost without being paid (raw mode only). */
    assumedTipUsd: sendMode === "raw" ? assumedJitoFeeUsd({ ownFeeUsd: configuredTip, simFeeUsd: simJitoUsd, scale, scaling: live.scaleJitoFee !== false }) : 0,
    tradeSizeUsd: finite(sim?.settings?.tradeSizeUsd, 0) * scale,
  };
}

/** The network fee of a transaction: the base fee plus the priority fee on its compute-unit limit. */
export function networkFeeLamports(computeUnits, priorityMicroLamports) {
  return BASE_FEE_LAMPORTS + Math.ceil((computeUnits * priorityMicroLamports) / 1_000_000);
}
