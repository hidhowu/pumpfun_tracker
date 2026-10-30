import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { TradingError, resetDryRun } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/** Resets the dry run: every exit style starts again from zero on the dry trades opened from now on. Nothing is deleted. */
export async function POST(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  try {
    return NextResponse.json(await resetDryRun(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof TradingError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "The reset failed" }, { status: 500 });
  }
}
