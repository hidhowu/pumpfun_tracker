/**
 * Progress math shared by the API (what the UI shows) - kept apart from the
 * worker so the web app never imports worker code.
 *
 * An address's progress is weighted: collecting its transactions is the first
 * ~35% and simulating its trades the remaining ~65%. Both stages know their
 * own totals only once they start (signatures to process after listing, tokens
 * after collecting), so the percentage is conservative early and never goes
 * backwards.
 */
const COLLECT_WEIGHT = 0.35;

export function collectFraction(rt) {
  const c = rt.collect || {};
  if (c.done) return 1;
  if (c.listing) return 0.02;
  if (!c.signaturesToProcess) return c.signaturesFound > 0 || rt.stage !== "pending" ? 0.02 : 0;
  return 0.02 + 0.98 * Math.min(1, (c.signaturesProcessed || 0) / c.signaturesToProcess);
}

export function simFraction(rt) {
  const s = rt.sim || {};
  if (s.done) return 1;
  if (!s.signalsTotal) return 0;
  return Math.min(1, (s.signalsDone || 0) / s.signalsTotal);
}

/** 0-100 for one address. */
export function traderProgressPercent(rt) {
  if (rt.stage === "done") return 100;
  return 100 * (COLLECT_WEIGHT * collectFraction(rt) + (1 - COLLECT_WEIGHT) * simFraction(rt));
}

/** Mean of the addresses' progress, 0-100 (a finished/failed address counts as complete). */
export function runProgressPercent(runTraders) {
  if (runTraders.length === 0) return 0;
  const sum = runTraders.reduce((acc, rt) => acc + (rt.stage === "failed" ? 100 : traderProgressPercent(rt)), 0);
  return sum / runTraders.length;
}

/** Milliseconds left, extrapolated from active working time so far; null while there isn't enough signal. */
export function estimateRemainingMs(percent, activeMs) {
  if (percent <= 1 || percent >= 100 || activeMs < 20_000) return null;
  return Math.round((activeMs * (100 - percent)) / percent);
}
