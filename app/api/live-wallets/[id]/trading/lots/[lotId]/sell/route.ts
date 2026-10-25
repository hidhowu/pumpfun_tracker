import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { TradingError, sellLotNow } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string; lotId: string }> };

/** "Sell now": queues a sell of one open live position (used when a sell gave up). It sells only that position's own tokens. */
export async function POST(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id, lotId } = await params;
  if (!isObjectIdString(id) || !isObjectIdString(lotId)) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  try {
    return NextResponse.json(await sellLotNow(id, lotId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof TradingError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to queue the sell" }, { status: 500 });
  }
}
