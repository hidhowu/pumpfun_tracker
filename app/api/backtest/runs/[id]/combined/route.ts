import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { getCombinedWallet } from "@/db/backtest/combined";

type Params = { params: Promise<{ id: string }> };

/** The shared wallet of a combined backtest: balance, negative-balance events, daily results and the balance curve. 400 for a backtest that is not combined. */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const wallet = await getCombinedWallet(id).catch(() => undefined);
  if (wallet === undefined) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
  if (wallet === null) return NextResponse.json({ error: "This is not a combined backtest" }, { status: 400 });
  return NextResponse.json(JSON.parse(JSON.stringify(wallet)));
}
