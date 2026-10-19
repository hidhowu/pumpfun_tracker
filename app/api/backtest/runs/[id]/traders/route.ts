import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { listRunTraders } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string }> };

/**
 * A page of the run's addresses, filtered and sorted by the database - a run can have tens of thousands, so they are never sent all at once.
 * Query: filter? (all | profitable | losing | running | failed | skipped), sort? (pnl | combined | avgPnl | winRate | trades | lossDays | margin | withoutBest | avgPnlDay | profitDays | totalLoss),
 * dir? (asc | desc), page?, limit? (max 200), the limits minWinRate / minMargin / maxLossDays / minTrades / maxTrades / minAvgPnl / minPnl /
 * minAvgPnlPerDay / minProfitDaysPercent / maxTotalLoss / holdsWithoutBest,
 * and addressesOnly=1 for just the addresses that match (to select them all).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const result = await listRunTraders(id, {
    filter: sp.get("filter") || undefined,
    sort: sp.get("sort") || undefined,
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
    page: Number(sp.get("page")) || 1,
    limit: Number(sp.get("limit")) || 50,
    search: sp.get("search") || "",
    addressesOnly: sp.get("addressesOnly") === "1",
    limits: {
      minWinRate: sp.get("minWinRate"),
      minMargin: sp.get("minMargin"),
      maxLossDays: sp.get("maxLossDays"),
      minTrades: sp.get("minTrades"),
      maxTrades: sp.get("maxTrades"),
      minAvgPnl: sp.get("minAvgPnl"),
      minPnl: sp.get("minPnl"),
      minAvgPnlPerDay: sp.get("minAvgPnlPerDay"),
      minProfitDaysPercent: sp.get("minProfitDaysPercent"),
      maxTotalLoss: sp.get("maxTotalLoss"),
      holdsWithoutBest: sp.get("holdsWithoutBest"),
    },
  }).catch(() => null);
  if (!result) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(result)));
}
