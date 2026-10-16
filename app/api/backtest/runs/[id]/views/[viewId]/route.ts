import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { deleteView, getViewWallet, updateView } from "@/db/backtest/views";

type Params = { params: Promise<{ id: string; viewId: string }> };

/** The shared wallet of one combined view: balance, negative-balance events, daily results, the balance curve and a row per address. */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id, viewId } = await params;
  const wallet = await getViewWallet(id, viewId).catch(() => undefined);
  if (wallet === undefined) return NextResponse.json({ error: "View not found" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(wallet)));
}

/** Body: { name?: string, addresses?: string[] (empty = every address of the backtest), config?: { startingBalanceUsd?, tradeSizeUsd?, pumpFeePercent?, jitoFeeUsd?, resetDaily?, allowNegativeBalance? } } */
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id, viewId } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const view = await updateView(id, viewId, { name: body.name, addresses: body.addresses, config: body.config });
    return NextResponse.json({ view: JSON.parse(JSON.stringify(view)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id, viewId } = await params;
  try {
    await deleteView(id, viewId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 404 });
  }
}
