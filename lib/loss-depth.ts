import type { BacktestLossDepth } from "@/lib/backtest-types";

/**
 * "Times reached": from how many starting trades did the balance go down at least `depthUsd`? `depths` is each starting trade's lowest
 * point (negative, deepest first), so this is the number of entries at or below -depthUsd.
 *
 * Example, trades +20 -5 +8 -7 +1 -15 +20 +20: the lowest points from trades 2..6 are -18, -13, -21, -14, -15, so a -$12 level was reached from 5 starting trades.
 */
export function countReaches(depths: BacktestLossDepth["depths"], depthUsd: number): number {
  if (!(depthUsd > 0)) return 0;
  const line = -depthUsd + 1e-9; // cents are rounded on the server; don't lose an exact hit to float noise
  let lo = 0;
  let hi = depths.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (depths[mid] <= line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Round-number loss levels up to the deepest one (a quarter, half and three quarters of it, then the deepest itself). */
export function lossLevels(deepestUsd: number): number[] {
  if (!(deepestUsd > 0)) return [];
  const levels = [0.25, 0.5, 0.75].map((f) => Number((deepestUsd * f).toPrecision(2))).filter((v) => v > 0 && v < deepestUsd);
  return [...new Set([...levels, deepestUsd])];
}
