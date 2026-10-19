import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { BacktestRun } from "@/db/models/BacktestRun";
import { runExportCsv } from "@/db/backtest/runExport";
import { csvDownloadResponse, todayStamp } from "@/lib/csv-stream";

type Params = { params: Promise<{ id: string }> };

/**
 * Downloads the backtest's addresses as CSV - the ones the run page is showing: the same status filter, limits, address search and sort.
 * Query: mode (addresses | summary | trades), includeSkipped=1 (trades mode: skipped signals too), and filter / sort / dir / search / minWinRate / minMargin /
 * maxLossDays / minTrades / maxTrades / minAvgPnl / minPnl / minAvgPnlPerDay / minProfitDaysPercent / maxTotalLoss / maxDayLossPercent / holdsWithoutBest as in /traders. Streamed, so any size works.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const run = await BacktestRun.findById(id, { name: 1 }).lean<{ name?: string }>().catch(() => null);
  if (!run) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const mode = sp.get("mode") === "summary" ? "summary" : sp.get("mode") === "trades" ? "trades" : "addresses";
  const chunks = runExportCsv(id, {
    mode,
    filter: sp.get("filter") || undefined,
    sort: sp.get("sort") || undefined,
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
    search: sp.get("search") || "",
    includeSkipped: sp.get("includeSkipped") === "1",
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
      maxDayLossPercent: sp.get("maxDayLossPercent"),
      holdsWithoutBest: sp.get("holdsWithoutBest"),
    },
  });
  const name = (run.name || "backtest").slice(0, 60);
  return csvDownloadResponse(chunks, `${name} - ${mode} - ${todayStamp()}.csv`);
}
