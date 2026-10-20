import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { isTwoFactorEnabled } from "@/db/authService";
import { isObjectIdString } from "@/db/settingsLimits";
import { TradingError, burnEmptyNow } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/** Runs the burn engine for this wallet right now: closes every token account holding five tokens or fewer (not ones with an open position) and returns their deposits. */
export async function POST(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  if (!(await isTwoFactorEnabled(user.id))) return NextResponse.json({ error: "Two-factor sign-in must be turned on (Account page) first." }, { status: 403 });
  try {
    return NextResponse.json(await burnEmptyNow(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof TradingError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "The sweep failed" }, { status: 500 });
  }
}
