import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { computeWalletRangePnl } from "@/db/walletPnl";

const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

type Params = { params: Promise<{ id: string }> };

/** ?period=day|week|month (default week) - drives the wallet's Performance tab chart + stat tiles. */
export async function GET(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const period = request.nextUrl.searchParams.get("period") || "week";
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.week;

  const pnl = await computeWalletRangePnl(id, days);
  return NextResponse.json({ period, ...pnl });
}
