import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { isTwoFactorEnabled } from "@/db/authService";
import { createLiveWallet, listLiveWallets, LiveWalletError } from "@/db/live/service";
import { parseClientPublicKey } from "@/db/live/walletKeys";

// Wallet data and key material must never be cached by the browser or a proxy.
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const user = (await getSessionUser())!;
  // twoFactorEnabled tells the page whether this account may create wallets / view keys (the server enforces it either way).
  return NextResponse.json({ wallets: await listLiveWallets(), twoFactorEnabled: await isTwoFactorEnabled(user.id) }, { headers: NO_STORE });
}

/**
 * Body: { name: string, clientPublicKey: string } - the browser's throwaway ECDH public key (lib/live-wallet-crypto.ts).
 * Needs two-factor turned on for the account. The response carries the new wallet's private key encrypted for that browser
 * only; to see it again later the owner goes through /api/live-wallets/[id]/reveal-key.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const user = (await getSessionUser())!;
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 100) : "";
  const clientPublicKey = parseClientPublicKey(body?.clientPublicKey);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!clientPublicKey) return NextResponse.json({ error: "clientPublicKey is required" }, { status: 400 });

  try {
    const { wallet, keyPayload } = await createLiveWallet({ userId: user.id, name, clientPublicKey });
    return NextResponse.json({ wallet, key: keyPayload }, { headers: NO_STORE });
  } catch (err) {
    const status = err instanceof LiveWalletError ? err.status : 500;
    return NextResponse.json({ error: err instanceof LiveWalletError ? err.message : "Failed to create wallet" }, { status });
  }
}
