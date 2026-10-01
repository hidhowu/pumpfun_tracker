import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { duplicateWallet } from "@/db/walletService";

type Params = { params: Promise<{ id: string }> };

/**
 * Body: { name: string, startingBalanceUsd: number, copySettings?: boolean,
 * copyTraders?: boolean, copyTrades?: boolean }. startingBalanceUsd is
 * ignored when copyTrades is true - see db/walletService.js's
 * duplicateWallet for why.
 */
export async function POST(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const startingBalanceUsd = Number(body.startingBalanceUsd);
  if (!body.copyTrades && (!Number.isFinite(startingBalanceUsd) || startingBalanceUsd <= 0)) {
    return NextResponse.json({ error: "startingBalanceUsd must be a positive number" }, { status: 400 });
  }

  try {
    const wallet = await duplicateWallet(id, {
      name,
      startingBalanceUsd,
      copySettings: !!body.copySettings,
      copyTraders: !!body.copyTraders,
      copyTrades: !!body.copyTrades,
    });
    return NextResponse.json({ wallet: JSON.parse(JSON.stringify(wallet)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to duplicate wallet" }, { status: 400 });
  }
}
