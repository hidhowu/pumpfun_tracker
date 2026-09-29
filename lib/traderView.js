import { getSystemSettings } from "@/db/models/SystemSettings";
import { getMarkedOpenPositions } from "@/db/simulation/positionsView";
import { resolveTraderSettings } from "@/db/settings";
import { computeTodayQuickStats } from "@/db/pnl";
import { ensureTodaySnapshot, currentPortfolioValueUsd } from "@/db/simulation/snapshot";
import { getTodayNegativeBalanceStats } from "@/db/negativeBalance";
import { ensureTraderInitialized } from "@/db/simulation/init";

/**
 * Plain-object trader, scoped to one profile: `muted` resolved against the
 * (shared, not per-profile) default, `sim`/`settings` sourced from that
 * profile's ProfileTrader row (lazily initialized if this is the first time
 * this profile has looked at this trader), `walletValueUsd` (balance +
 * current mark-to-market value of open positions within this profile -
 * distinct from `sim.balanceUsd`, which is just the uncommitted cash sitting
 * there), and `today` - today's sim P&L quick-stats for this profile
 * (actualized $, combined %, win rate). Involves a live price lookup per
 * open position (cached 15s), so not free, but cheap enough for a list
 * polled every several seconds across a modest number of traders.
 *
 * Pass `walletValueUsd`/`profileTrader` if the caller already computed them
 * (e.g. the detail view, which fetches open positions anyway) to avoid
 * fetching prices / the ProfileTrader row twice.
 */
export async function resolveTraderView(profileId, traderDoc, systemSettings, { walletValueUsd, profileTrader } = {}) {
  const sys = systemSettings || (await getSystemSettings());
  const plain = JSON.parse(JSON.stringify(traderDoc));
  const pt = profileTrader !== undefined ? profileTrader : await ensureTraderInitialized(profileId, plain.address);

  await ensureTodaySnapshot(profileId, plain.address);
  const value = walletValueUsd !== undefined ? walletValueUsd : await currentPortfolioValueUsd(profileId, plain.address);
  const [today, todayNegativeBalance] = await Promise.all([
    computeTodayQuickStats(profileId, plain.address, { currentValue: value }),
    getTodayNegativeBalanceStats(profileId, plain.address),
  ]);

  return {
    ...plain,
    id: plain._id,
    mutedOverride: plain.muted,
    muted: plain.muted === null || plain.muted === undefined ? sys.defaultMuted : plain.muted,
    sim: pt.sim,
    settings: pt.settings,
    walletValueUsd: value,
    today,
    todayNegativeBalance,
  };
}

export async function resolveTraderViews(profileId, traderDocs) {
  const sys = await getSystemSettings();
  return Promise.all(traderDocs.map((t) => resolveTraderView(profileId, t, sys)));
}

/**
 * Full detail view for the trader page, within one profile: trader +
 * resolved effective simulation settings for this profile (so the UI can
 * show "inherited: $20" vs an explicit override) + this trader's currently-
 * open SIMULATED positions in this profile, live-priced (mark-to-market),
 * plus total unrealized P&L and wallet value. Deliberately carries no
 * on-chain wallet data (holdings, on-chain trade history) - we only ever
 * act on the tracked wallet's buy/sell signals, we don't care what their
 * own wallet is worth.
 */
export async function resolveTraderDetailView(profileId, traderDoc) {
  const profileTrader = await ensureTraderInitialized(profileId, traderDoc.address);
  const [openPositions, effectiveSettings] = await Promise.all([
    getMarkedOpenPositions(profileId, traderDoc.address),
    resolveTraderSettings(profileId, traderDoc.address, { profileTrader }),
  ]);
  const unrealizedPnlUsd = openPositions.reduce((sum, p) => sum + (p.unrealizedPnlUsd || 0), 0);
  const openPositionsValueUsd = openPositions.reduce((sum, p) => sum + (p.currentValueUsd || 0), 0);
  const walletValueUsd = profileTrader.sim.balanceUsd + openPositionsValueUsd;

  const view = await resolveTraderView(profileId, traderDoc, undefined, { walletValueUsd, profileTrader });
  return { ...view, openPositions, unrealizedPnlUsd, effectiveSettings };
}
