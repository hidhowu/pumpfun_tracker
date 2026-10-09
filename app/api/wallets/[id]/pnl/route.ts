import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { computeWalletHourlyBreakdown, computeWalletRangePnl } from "@/db/walletPnl";
import { currentWalletValueUsd } from "@/db/simulation/walletSnapshot";
import { todayUtcString } from "@/db/simulation/snapshot";

const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

/**
 * ?period=day|week|month (default week) - drives the wallet's Performance tab chart + stat tiles.
 * ?date=YYYY-MM-DD (UTC, optional, no later than today) - the day to show for period=day (default today).
 * period=day also returns `hourlyBreakdown`: that day's 24 hour buckets.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const period = request.nextUrl.searchParams.get("period") || "week";
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.week;

  const today = todayUtcString();
  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam && DATE_RE.test(dateParam) && dateParam <= today ? dateParam : today;

  // Looked up once and shared, since it's a live price lookup per open position.
  const currentValue = date === today ? await currentWalletValueUsd(id) : undefined;

  const pnl = await computeWalletRangePnl(id, days, { endDate: date, currentValue });
  const hourlyBreakdown = days === 1 ? await computeWalletHourlyBreakdown(id, date, { currentValue }) : undefined;
  return NextResponse.json({ period, date, ...pnl, hourlyBreakdown });
}
