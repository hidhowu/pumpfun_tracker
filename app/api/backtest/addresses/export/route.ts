import { NextRequest } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { addressListCsv } from "@/db/backtest/runExport";
import { csvDownloadResponse, todayStamp } from "@/lib/csv-stream";

/** Downloads the backtest list as CSV (only what matches `search`, if given). Query: search?, mode (addresses | full). Streamed, so any size works. */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const sp = request.nextUrl.searchParams;
  const mode = sp.get("mode") === "full" ? "full" : "addresses";
  return csvDownloadResponse(addressListCsv({ search: sp.get("search") || "", mode }), `backtest list - ${mode} - ${todayStamp()}.csv`);
}
