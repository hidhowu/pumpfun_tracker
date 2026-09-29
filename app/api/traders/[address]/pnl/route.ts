import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { computeRangePnl } from "@/db/pnl";
import { ensureTodaySnapshot } from "@/db/simulation/snapshot";
import { getNegativeBalanceBreakdown } from "@/db/negativeBalance";

type Params = { params: Promise<{ address: string }> };

const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

/** ?period=day|week|month (default week) */
export async function GET(request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const period = request.nextUrl.searchParams.get("period") || "week";
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.week;

  await ensureTodaySnapshot(profileId, address); // self-healing if the daemon missed today's snapshot
  const [pnl, negativeBalanceBreakdown] = await Promise.all([
    computeRangePnl(profileId, address, days),
    getNegativeBalanceBreakdown(profileId, address, days),
  ]);
  return NextResponse.json({ period, ...pnl, negativeBalanceBreakdown });
}
