import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { createWallet, listWallets } from "@/db/walletService";

export async function GET() {
  await connectDb();
  const wallets = await listWallets();
  return NextResponse.json({ wallets: JSON.parse(JSON.stringify(wallets)) });
}

/** Body: { name: string, startingBalanceUsd: number } */
export async function POST(request: NextRequest) {
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const startingBalanceUsd = Number(body.startingBalanceUsd);

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!Number.isFinite(startingBalanceUsd) || startingBalanceUsd <= 0) {
    return NextResponse.json({ error: "startingBalanceUsd must be a positive number" }, { status: 400 });
  }

  const wallet = await createWallet({ name, startingBalanceUsd });
  return NextResponse.json({ wallet: JSON.parse(JSON.stringify(wallet)) });
}
