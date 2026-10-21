import type { BacktestLossDepth } from "@/lib/backtest-types";

/**
 * How many times the running P&L dropped to `depthUsd` below zero. It counts a drop through the line as one time; it only counts again
 * after the P&L has climbed back above the line first. (Going from -130 to -125 and down again is still the same visit; going from
 * -130 to -40 and later to -90 is two visits to a -80 line.)
 *
 * `swings` are the turning points of the running P&L (peaks and troughs), which is all that matters here: between two turning points the
 * P&L only moves one way, so it crosses a line exactly when the two points are on opposite sides of it.
 */
export function countReaches(swings: BacktestLossDepth["swings"], depthUsd: number): { count: number; at: number[] } {
  const at: number[] = [];
  if (!(depthUsd > 0)) return { count: 0, at };
  const line = -depthUsd;
  let armed = true;
  for (const point of swings) {
    if (armed && point.pnlUsd <= line) {
      at.push(point.t);
      armed = false;
    } else if (!armed && point.pnlUsd > line) {
      armed = true;
    }
  }
  return { count: at.length, at };
}

/** Round-number loss levels up to the deepest one (a quarter, half and three quarters of it, then the deepest itself). */
export function lossLevels(deepestUsd: number): number[] {
  if (!(deepestUsd > 0)) return [];
  const levels = [0.25, 0.5, 0.75].map((f) => Number((deepestUsd * f).toPrecision(2))).filter((v) => v > 0 && v < deepestUsd);
  return [...new Set([...levels, deepestUsd])];
}
