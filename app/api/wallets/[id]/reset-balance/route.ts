import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { resetWalletBalance } from "@/db/walletService";

type Params = { params: Promise<{ id: string }> };

/** Resets balanceUsd back to startingBalanceUsd only - every position, trade history, and realizedPnlUsd is left untouched. */
export async function POST(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;

  try {
    const wallet = await resetWalletBalance(id);
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    return NextResponse.json({ wallet: JSON.parse(JSON.stringify(wallet)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to reset wallet balance" }, { status: 400 });
  }
}
