import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { createWallet, listWallets } from "@/db/walletService";
import { applyDailyBalanceResets } from "@/db/simulation/walletSnapshot";
import { LiveWallet } from "@/db/models/LiveWallet";

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  // Backstop for the daemon's minute-by-minute check - see applyDailyBalanceResets.
  await applyDailyBalanceResets().catch(() => {});
  const wallets = await listWallets();
  // Read-only flag for the list: which simulation wallets have a live wallet connected to them.
  const linked = new Set((await LiveWallet.distinct("connectedWalletId")).filter(Boolean).map(String));
  const withLink = JSON.parse(JSON.stringify(wallets)).map((w: { _id: string }) => ({ ...w, linkedLive: linked.has(String(w._id)) }));
  return NextResponse.json({ wallets: withLink });
}

/** Body: { name: string, startingBalanceUsd: number } */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const startingBalanceUsd = Number(body.startingBalanceUsd);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!Number.isFinite(startingBalanceUsd) || startingBalanceUsd <= 0) {
    return NextResponse.json({ error: "startingBalanceUsd must be a positive number" }, { status: 400 });
  }

  try {
    const wallet = await createWallet({ name, startingBalanceUsd });
    return NextResponse.json({ wallet: JSON.parse(JSON.stringify(wallet)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create wallet" }, { status: 400 });
  }
}
