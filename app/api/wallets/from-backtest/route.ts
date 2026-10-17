import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { createWalletsFromBacktestViews } from "@/db/walletService";

/**
 * Body: { runId: string, viewIds?: string[] (omitted = every view of the run), settingsFromWalletId?: string,
 * useWalletMoneySettings?: boolean }. Creates one wallet per combined view - see createWalletsFromBacktestViews.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  if (typeof body.runId !== "string" || !body.runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });
  const viewIds = Array.isArray(body.viewIds) ? body.viewIds.filter((v: unknown) => typeof v === "string") : undefined;

  try {
    const result = await createWalletsFromBacktestViews(body.runId, {
      viewIds,
      settingsFromWalletId: typeof body.settingsFromWalletId === "string" && body.settingsFromWalletId ? body.settingsFromWalletId : null,
      useWalletMoneySettings: !!body.useWalletMoneySettings,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create wallets" }, { status: 400 });
  }
}
