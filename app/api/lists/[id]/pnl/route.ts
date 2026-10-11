import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { TraderList } from "@/db/models/TraderList";
import { computeListRangePnl, computeListSummary, currentListValueUsd, getListAddresses } from "@/db/listPnl";
import { todayUtcString } from "@/db/simulation/snapshot";

const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

/**
 * ?profileId= (required) - the profile whose simulation the list's traders are measured on.
 * ?period=day|week|month (default week), ?date=YYYY-MM-DD (the day shown for period=day, default today).
 * Same response shape as the wallet pnl endpoint, plus `list` and `summary`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });

  const list = await TraderList.findById(id).lean();
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const period = request.nextUrl.searchParams.get("period") || "week";
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.week;
  const today = todayUtcString();
  const dateParam = request.nextUrl.searchParams.get("date");
  const date = dateParam && DATE_RE.test(dateParam) && dateParam <= today ? dateParam : today;

  const addresses = await getListAddresses(id);
  // One live price pass, shared by the chart and the summary tiles.
  const currentValue = await currentListValueUsd(profileId, addresses);
  const [pnl, summary] = await Promise.all([
    computeListRangePnl(profileId, addresses, days, { endDate: date, currentValue: date === today ? currentValue : undefined }),
    computeListSummary(profileId, addresses, { currentValue }),
  ]);
  return NextResponse.json({
    list: JSON.parse(JSON.stringify({ _id: list._id, name: list.name })),
    period,
    date,
    ...pnl,
    summary,
  });
}
