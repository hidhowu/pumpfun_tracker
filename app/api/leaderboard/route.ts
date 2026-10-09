import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Trader } from "@/db/models/Trader";
import { computeRangePnlBatch } from "@/db/pnl";
import { resolveTraderViews } from "@/lib/traderView";

const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

/**
 * Top traders ranked by combined (realized, closed-trade) P&L% over the
 * period, within one profile - the "who's actually good at this, not just
 * lucky" ranking. ?period=day|week|month (default week), ?profileId=
 * (required).
 */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const period = request.nextUrl.searchParams.get("period") || "week";
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.week;

  const traders = await Trader.find({ status: "active" }).lean();

  // resolveTraderViews (batched) initializes each trader in this profile,
  // makes sure today's baseline snapshot exists, and gives the live value
  // today's actualized P&L is measured to - then the whole range is computed
  // in two queries for every trader at once.
  const views = await resolveTraderViews(profileId, traders);
  const currentValueByAddress = new Map(views.map((v) => [v.address as string, v.walletValueUsd as number]));
  const pnlByAddress = await computeRangePnlBatch(
    profileId,
    traders.map((t) => t.address),
    days,
    { currentValueByAddress }
  );

  const ranked = views.map((view) => {
    const pnl = pnlByAddress.get(view.address)!;
    return {
      address: view.address,
      label: view.label,
      balanceUsd: view.sim.balanceUsd,
      startingAllocationUsd: view.sim.startingAllocationUsd,
      combinedPercent: pnl.combinedPercent,
      actualizedUsd: pnl.actualizedUsd,
      closedTradeCount: pnl.closedTradeCount,
      streaks: pnl.streaks,
    };
  });

  ranked.sort((a, b) => b.combinedPercent - a.combinedPercent);
  return NextResponse.json({ period, leaderboard: ranked });
}
