import { WalletPosition } from "./models/WalletPosition.js";

/**
 * "Should I panic?" for a simulation wallet. The wallet has a panic level (Wallet.settings.panicLossUsd, in dollars): how deep a loss
 * stretch it may go through before it is doing worse than its backtest led us to expect (normally a little beyond the backtest's
 * "deepest point", see lossDepthView in db/backtest/dayStats.js). This works out where the wallet stands against that level.
 *
 * A loss stretch is the same idea as the backtest's deepest point: closed trades in the order they closed, profit in between counts, and
 * the stretch is how far the running total has fallen from its highest point so far. Two figures come out of it:
 *
 *  currentLossUsd   how far below its highest point the running total is RIGHT NOW (0 when it sits at a new high). This is what fills the
 *                   bar, so it drains again as the wallet recovers.
 *  deepestLossUsd   the worst such fall the wallet has ever had since it began (what the backtest calls the deepest point).
 *
 * `panic` is true while currentLossUsd has reached the level; `everPanicked` stays true once deepestLossUsd has.
 * Realised results of closed trades only - the same basis as the backtest figure, so the two are comparable; an open trade has no result yet.
 * Display only: nothing here stops or changes a trade.
 */
export async function walletPanic(walletId, limitUsd) {
  if (!(limitUsd > 0)) return null;
  const closed = await WalletPosition.find({ walletId, status: "closed", closedAt: { $ne: null } }, { closedAt: 1, realizedPnlUsd: 1 })
    .sort({ closedAt: 1 })
    .lean();

  let running = 0;
  let peak = 0;
  let deepest = 0;
  let deepestAt = null;
  for (const position of closed) {
    running += position.realizedPnlUsd || 0;
    if (running > peak) peak = running;
    if (peak - running > deepest) {
      deepest = peak - running;
      deepestAt = position.closedAt;
    }
  }
  const current = peak - running;
  const EPS = 1e-9;
  return {
    limitUsd,
    currentLossUsd: current,
    deepestLossUsd: deepest,
    deepestAt,
    fraction: current / limitUsd, // may pass 1
    panic: current + EPS >= limitUsd,
    everPanicked: deepest + EPS >= limitUsd,
    closedTrades: closed.length,
  };
}

/** Adds `panic` (null when the wallet has no panic level) to a plain wallet object. */
export async function withPanic(wallet) {
  return { ...wallet, panic: await walletPanic(wallet._id, wallet.settings?.panicLossUsd) };
}
