import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { createViews, listViews } from "@/db/backtest/views";

type Params = { params: Promise<{ id: string }> };

/** Every combined view of a backtest with its headline numbers (the backtest's trades are read once for all of them). */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const res = await listViews(id).catch(() => undefined);
  if (res === undefined) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(res)));
}

/**
 * Body: { views: Array<{ name?: string, addresses?: string[] }> (no addresses = every address of the backtest), config: { startingBalanceUsd, tradeSizeUsd, pumpFeePercent, jitoFeeUsd, resetDaily?, allowNegativeBalance? } }
 * Creates one view per entry, all with the same settings. Nothing is simulated: each view re-prices the backtest's stored trades.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const views = await createViews(id, { views: body.views, config: body.config });
    return NextResponse.json({ views: JSON.parse(JSON.stringify(views)) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}
