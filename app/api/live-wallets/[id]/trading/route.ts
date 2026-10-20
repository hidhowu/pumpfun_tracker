import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";
import { isObjectIdString } from "@/db/settingsLimits";
import { TradingError, getTradingState, updateTrading } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "no-store" };

/** The live wallet's copy-trading state: the connected simulation wallet, the switches, warnings. */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const state = await getTradingState(id);
  if (!state) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json(state, { headers: NO_STORE });
}

/**
 * Body (every field optional): { connectedWalletId: string | null, tradingMode: "dry" | "live", exitMode: "own" | "follow",
 * buySlippagePercent: number, sellSlippagePercent: number, code?: string }.
 * Needs two-factor on. Switching to "live" also needs `code`, a fresh authenticator code. A new connection always starts as a dry run.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send the settings to change." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const key of ["connectedWalletId", "tradingMode", "exitMode", "buySlippagePercent", "sellSlippagePercent"]) {
    if (key in body) patch[key] = body[key];
  }

  try {
    const state = await updateTrading(id, patch, { userId: user.id, username: user.username, code: typeof body.code === "string" ? body.code : undefined, ip: clientIp(request.headers) });
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof TradingError) return NextResponse.json({ error: err.message }, { status: err.status, ...(err.status === 429 ? { headers: { "Retry-After": "60" } } : {}) });
    return NextResponse.json({ error: "Failed to change the settings" }, { status: 500 });
  }
}
