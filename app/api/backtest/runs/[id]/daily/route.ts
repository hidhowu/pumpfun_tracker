import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { getRunDaily } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string }> };

/** Query: page?, limit? (max 200) - the addresses are paged (best P&L first); the "all addresses" totals always cover the whole run. */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const daily = await getRunDaily(id, { page: Number(sp.get("page")) || 1, limit: Number(sp.get("limit")) || 50 }).catch(() => null);
  if (!daily) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(daily)));
}
