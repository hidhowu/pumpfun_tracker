import { getSystemSettings } from "@/db/models/SystemSettings";
import { getMarkedOpenPositions } from "@/db/simulation/positionsView";
import { resolveTraderSettings } from "@/db/settings";
import { computeTodayQuickStats } from "@/db/pnl";
import { ensureTodaySnapshot, currentPortfolioValueUsd, todayUtcString } from "@/db/simulation/snapshot";
import { getTodayNegativeBalanceStats } from "@/db/negativeBalance";
import { ensureTraderInitialized } from "@/db/simulation/init";
import { ProfileTrader } from "@/db/models/ProfileTrader";
import { DailySnapshot } from "@/db/models/DailySnapshot";
import { SimPosition } from "@/db/models/SimPosition";
import { NegativeBalanceEvent } from "@/db/models/NegativeBalanceEvent";
import { getPrice, prefetchPrices } from "@/db/pumpFunApi";

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

/**
 * Batched equivalent of calling resolveTraderView for every trader - same
 * output, but a fixed handful of queries for the WHOLE list instead of ~7
 * per trader. The trader list polls this every few seconds; with ~100
 * traders the per-trader version fired ~700 concurrent Mongo queries per
 * poll, which is what made the dashboard sluggish.
 */
export async function resolveTraderViews(profileId, traderDocs) {
  if (traderDocs.length === 0) return [];
  const sys = await getSystemSettings();
  const addresses = traderDocs.map((t) => t.address);
  const today = todayUtcString();
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [profileTraders, snapshots, openPositions, closedToday, negativeEvents] = await Promise.all([
    ProfileTrader.find({ profileId, traderAddress: { $in: addresses } }),
    DailySnapshot.find({ profileId, date: today, traderAddress: { $in: addresses } }).lean(),
    SimPosition.find({ profileId, status: "open", traderAddress: { $in: addresses } }, { traderAddress: 1, mint: 1, tokenAmount: 1, costBasisUsd: 1 }).lean(),
    SimPosition.find(
      { profileId, status: "closed", closedAt: { $gte: dayStart, $lt: dayEnd }, traderAddress: { $in: addresses } },
      { traderAddress: 1, realizedPnlUsd: 1, realizedPnlPercent: 1 }
    ).lean(),
    NegativeBalanceEvent.find({ profileId, occurredAt: { $gte: dayStart, $lt: dayEnd }, traderAddress: { $in: addresses } }, { traderAddress: 1, depthUsd: 1 }).lean(),
  ]);

  const ptByAddress = new Map(profileTraders.map((pt) => [pt.traderAddress, pt]));
  const snapByAddress = new Map(snapshots.map((s) => [s.traderAddress, s]));
  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.traderAddress)) map.set(row.traderAddress, []);
      map.get(row.traderAddress).push(row);
    }
    return map;
  };
  const openByAddress = group(openPositions);
  const closedByAddress = group(closedToday);
  const negByAddress = group(negativeEvents);

  // One bounded, cached price warm-up for every open mint across every trader.
  await prefetchPrices(openPositions.map((p) => p.mint));

  return Promise.all(
    traderDocs.map(async (traderDoc) => {
      const plain = JSON.parse(JSON.stringify(traderDoc));
      let pt = ptByAddress.get(plain.address);
      if (!pt?.sim?.initialized) pt = await ensureTraderInitialized(profileId, plain.address);

      const openValues = await Promise.all(
        (openByAddress.get(plain.address) || []).map(async (p) => {
          const price = await getPrice(p.mint);
          return price?.priceUsd ? p.tokenAmount * price.priceUsd : p.costBasisUsd;
        })
      );
      const value = pt.sim.balanceUsd + openValues.reduce((sum, v) => sum + v, 0);

      // Same self-healing baseline as ensureTodaySnapshot, seeded from the value just computed.
      let snap = snapByAddress.get(plain.address);
      if (!snap) {
        snap = await DailySnapshot.create({ profileId, traderAddress: plain.address, date: today, portfolioValueUsdAtOpen: value }).catch((err) => {
          if (err?.code === 11000) return DailySnapshot.findOne({ profileId, traderAddress: plain.address, date: today }).lean();
          throw err;
        });
      }
      const startValue = snap?.portfolioValueUsdAtOpen ?? null;
      const actualizedUsd = startValue !== null ? value - startValue : null;

      const closed = closedByAddress.get(plain.address) || [];
      const wins = closed.filter((p) => (p.realizedPnlUsd || 0) > 0).length;
      const losses = closed.filter((p) => (p.realizedPnlUsd || 0) < 0).length;
      const neg = negByAddress.get(plain.address) || [];

      return {
        ...plain,
        id: plain._id,
        listIds: plain.listIds ?? [], // .lean() skips schema defaults, so traders added before lists existed have no listIds
        mutedOverride: plain.muted,
        muted: plain.muted === null || plain.muted === undefined ? sys.defaultMuted : plain.muted,
        sim: pt.sim,
        settings: pt.settings,
        walletValueUsd: value,
        today: {
          date: today,
          actualizedUsd,
          actualizedPercent: startValue ? (actualizedUsd / startValue) * 100 : null,
          combinedUsd: closed.reduce((sum, p) => sum + (p.realizedPnlUsd || 0), 0),
          combinedPercent: closed.reduce((sum, p) => sum + (p.realizedPnlPercent || 0), 0),
          closedTradeCount: closed.length,
          wins,
          losses,
          winRatePercent: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
        },
        todayNegativeBalance: {
          date: today,
          count: neg.length,
          maxDepthUsd: neg.length > 0 ? Math.max(...neg.map((e) => e.depthUsd)) : 0,
        },
      };
    })
  );
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
