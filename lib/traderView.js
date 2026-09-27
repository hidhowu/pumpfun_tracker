import { getGlobalSettings } from "@/db/models/GlobalSettings";
import { getMarkedOpenPositions } from "@/db/simulation/positionsView";
import { resolveTraderSettings } from "@/db/settings";
import { computeTodayQuickStats } from "@/db/pnl";
import { ensureTodaySnapshot, currentPortfolioValueUsd } from "@/db/simulation/snapshot";
import { getTodayNegativeBalanceStats } from "@/db/negativeBalance";

/**
 * Plain-object trader with `muted` resolved against the global default,
 * `walletValueUsd` (balance + current mark-to-market value of open
 * positions - distinct from `sim.balanceUsd`, which is just the uncommitted
 * cash sitting there), and `today` - today's sim P&L quick-stats
 * (actualized $, combined %, win rate). Involves a live price lookup per
 * open position (cached 15s), so not free, but cheap enough for a list
 * polled every several seconds across a modest number of traders.
 *
 * Pass `walletValueUsd` if the caller already computed it (e.g. the detail
 * view, which fetches open positions anyway) to avoid fetching prices twice.
 */
export async function resolveTraderView(traderDoc, globalSettings, { walletValueUsd } = {}) {
  const settings = globalSettings || (await getGlobalSettings());
  const plain = JSON.parse(JSON.stringify(traderDoc));
  await ensureTodaySnapshot(plain.address);
  const value = walletValueUsd !== undefined ? walletValueUsd : await currentPortfolioValueUsd(plain.address);
  const [today, todayNegativeBalance] = await Promise.all([
    computeTodayQuickStats(plain.address, { currentValue: value }),
    getTodayNegativeBalanceStats(plain.address),
  ]);
  return {
    ...plain,
    id: plain._id,
    mutedOverride: plain.muted,
    muted: plain.muted === null || plain.muted === undefined ? settings.defaultMuted : plain.muted,
    walletValueUsd: value,
    today,
    todayNegativeBalance,
  };
}

export async function resolveTraderViews(traderDocs) {
  const settings = await getGlobalSettings();
  return Promise.all(traderDocs.map((t) => resolveTraderView(t, settings)));
}

/**
 * Full detail view for the trader page: trader + resolved effective
 * simulation settings (so the UI can show "inherited: $20" vs an explicit
 * override) + this trader's currently-open SIMULATED positions, live-priced
 * (mark-to-market), plus their total unrealized P&L and wallet value.
 * Deliberately carries no on-chain wallet data (holdings, on-chain trade
 * history) - we only ever act on the tracked wallet's buy/sell signals, we
 * don't care what their own wallet is worth.
 */
export async function resolveTraderDetailView(traderDoc) {
  const [openPositions, effectiveSettings] = await Promise.all([
    getMarkedOpenPositions(traderDoc.address),
    resolveTraderSettings(traderDoc),
  ]);
  const unrealizedPnlUsd = openPositions.reduce((sum, p) => sum + (p.unrealizedPnlUsd || 0), 0);
  const openPositionsValueUsd = openPositions.reduce((sum, p) => sum + (p.currentValueUsd || 0), 0);
  const walletValueUsd = traderDoc.sim.balanceUsd + openPositionsValueUsd;

  const view = await resolveTraderView(traderDoc, undefined, { walletValueUsd });
  return { ...view, openPositions, unrealizedPnlUsd, effectiveSettings };
}
