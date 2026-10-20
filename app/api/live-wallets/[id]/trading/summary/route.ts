import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { getTradingSummary } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/** Totals over the settled trades: live next to simulation, costs, the dry-run comparison of the two exit modes, and the cumulative P&L by day. */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const summary = await getTradingSummary(id);
  if (!summary) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
