import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";
import { isObjectIdString } from "@/db/settingsLimits";
import { LiveWalletError, revealLiveWalletKey } from "@/db/live/service";
import { parseClientPublicKey } from "@/db/live/walletKeys";

type Params = { params: Promise<{ id: string }> };

/**
 * Body: { code: string, clientPublicKey: string }. Shows the wallet's private key again, but only to an account with
 * two-factor on that supplies a fresh authenticator code. The key comes back encrypted for the browser's throwaway key
 * (lib/live-wallet-crypto.ts), never in plain text. Wrong codes are throttled per account and per IP.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().slice(0, 12) : "";
  const clientPublicKey = parseClientPublicKey(body?.clientPublicKey);
  if (!code) return NextResponse.json({ error: "Enter the code from your authenticator app." }, { status: 400 });
  if (!clientPublicKey) return NextResponse.json({ error: "clientPublicKey is required" }, { status: 400 });

  try {
    const key = await revealLiveWalletKey(id, { userId: user.id, username: user.username, code, clientPublicKey, ip: clientIp(request.headers) });
    return NextResponse.json({ key }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof LiveWalletError) {
      return NextResponse.json({ error: err.message }, { status: err.status, ...(err.status === 429 ? { headers: { "Retry-After": "60" } } : {}) });
    }
    return NextResponse.json({ error: "Failed to read the key" }, { status: 500 });
  }
}
