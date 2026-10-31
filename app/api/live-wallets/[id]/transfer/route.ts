import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";
import { isObjectIdString } from "@/db/settingsLimits";
import { LiveWalletError, transferLiveWalletSol } from "@/db/live/service";

type Params = { params: Promise<{ id: string }> };

/**
 * Body: { toWalletId: string, amountSol?: string | number, all?: boolean, code: string }. Sends SOL from this wallet to another live wallet on
 * this platform (never to an outside address - the destination is a wallet id). `all` sends everything but the network fee. Needs two-factor on and
 * a fresh authenticator code. Can take up to a minute while the transaction confirms.
 */
export const maxDuration = 90;

export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const toWalletId = typeof body?.toWalletId === "string" ? body.toWalletId : "";
  if (!isObjectIdString(toWalletId)) return NextResponse.json({ error: "Choose the wallet to send to" }, { status: 400 });
  const code = typeof body?.code === "string" ? body.code.trim().slice(0, 12) : "";
  if (!code) return NextResponse.json({ error: "Enter the code from your authenticator app." }, { status: 400 });
  const all = body?.all === true;
  const amountSol = typeof body?.amountSol === "string" || typeof body?.amountSol === "number" ? body.amountSol : undefined;

  try {
    const result = await transferLiveWalletSol(id, { userId: user.id, username: user.username, toId: toWalletId, amountSol, all, code, ip: clientIp(request.headers) });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof LiveWalletError) {
      return NextResponse.json({ error: err.message }, { status: err.status, ...(err.status === 429 ? { headers: { "Retry-After": "60" } } : {}) });
    }
    return NextResponse.json({ error: "Failed to send the SOL" }, { status: 500 });
  }
}
