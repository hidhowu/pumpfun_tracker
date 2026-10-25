import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { getTradingStats } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/** Transaction stats: how fast they land (min / max / average / percentiles), successes, failures and retries. `?hours=24` limits it to recent attempts. */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const hours = Number(request.nextUrl.searchParams.get("hours"));
  const stats = await getTradingStats(id, { hours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 24 * 365) : null });
  if (!stats) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
}
