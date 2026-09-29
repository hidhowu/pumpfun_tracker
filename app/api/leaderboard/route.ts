import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { Trader } from "@/db/models/Trader";
import { computeRangePnl } from "@/db/pnl";
import { ensureTodaySnapshot } from "@/db/simulation/snapshot";
import { ensureTraderInitialized } from "@/db/simulation/init";

const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

/**
 * Top traders ranked by combined (realized, closed-trade) P&L% over the
 * period, within one profile - the "who's actually good at this, not just
 * lucky" ranking. ?period=day|week|month (default week), ?profileId=
 * (required).
 */
export async function GET(request: NextRequest) {
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const period = request.nextUrl.searchParams.get("period") || "week";
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.week;

  const traders = await Trader.find({ status: "active" }).lean();

  const ranked = await Promise.all(
    traders.map(async (trader) => {
      const profileTrader = await ensureTraderInitialized(profileId, trader.address);
      await ensureTodaySnapshot(profileId, trader.address);
      const pnl = await computeRangePnl(profileId, trader.address, days);
      return {
        address: trader.address,
        label: trader.label,
        balanceUsd: profileTrader.sim.balanceUsd,
        startingAllocationUsd: profileTrader.sim.startingAllocationUsd,
        combinedPercent: pnl.combinedPercent,
        actualizedUsd: pnl.actualizedUsd,
        closedTradeCount: pnl.closedTradeCount,
        streaks: pnl.streaks,
      };
    })
  );

  ranked.sort((a, b) => b.combinedPercent - a.combinedPercent);
  return NextResponse.json({ period, leaderboard: ranked });
}
