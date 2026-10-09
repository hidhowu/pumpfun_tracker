import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { resetWallet } from "@/db/walletService";

type Params = { params: Promise<{ id: string }> };

/** Wipes this wallet's trade history (positions, pending fills, daily snapshots) and every assigned trader's per-wallet stats, resetting balance back to the wallet's starting balance. Preserves settings and trader assignments. */
export async function POST(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;

  try {
    const wallet = await resetWallet(id);
    if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
    return NextResponse.json({ wallet: JSON.parse(JSON.stringify(wallet)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to reset wallet" }, { status: 400 });
  }
}
