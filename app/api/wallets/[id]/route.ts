import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Wallet } from "@/db/models/Wallet";
import { isObjectIdString } from "@/db/settingsLimits";
import { deleteWallet, renameWallet, updateWalletSettings } from "@/db/walletService";
import { applyDailyBalanceResets } from "@/db/simulation/walletSnapshot";
import { withPanic } from "@/db/walletPanic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  // Backstop for the daemon's minute-by-minute check - see applyDailyBalanceResets.
  await applyDailyBalanceResets().catch(() => {});
  // Hydrated (not .lean()) so schema defaults fill in settings added after
  // this wallet was created (e.g. pumpFeePercent/jitoFeeUsd).
  const wallet = await Wallet.findById(id);
  if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json({ wallet: await withPanic(JSON.parse(JSON.stringify(wallet))) });
}

/** Body: { name?: string, settings?: Partial<Wallet["settings"]> } - either or both. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  let wallet = null;
  try {
    if (typeof body.name === "string" && body.name.trim()) {
      wallet = await renameWallet(id, body.name.trim().slice(0, 100));
    }
    if (body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)) {
      wallet = await updateWalletSettings(id, body.settings);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update wallet" }, { status: 400 });
  }
  if (!wallet) wallet = await Wallet.findById(id);
  if (!wallet) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json({ wallet: await withPanic(JSON.parse(JSON.stringify(wallet))) });
}

/** Cascades WalletTrader/WalletPosition/WalletPendingExecution/WalletDailySnapshot - see db/walletService.js's deleteWallet. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  try {
    await deleteWallet(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete wallet" }, { status: 409 });
  }
}
