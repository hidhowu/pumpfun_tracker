import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { SystemLog } from "@/db/models/SystemLog";

/**
 * Recent entries for the Logs UI section. ?category=rpc|tracker|trade
 * (omit for all), ?limit=N (default 100, capped 500). Entries older than
 * 24h are already gone by the time this runs - see SystemLog's TTL index.
 */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const category = request.nextUrl.searchParams.get("category");
  const limit = Math.min(500, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "100")));

  const filter: Record<string, unknown> = {};
  if (category === "rpc" || category === "tracker" || category === "trade") {
    filter.category = category;
  }

  const logs = await SystemLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return NextResponse.json({ logs: JSON.parse(JSON.stringify(logs)) });
}
