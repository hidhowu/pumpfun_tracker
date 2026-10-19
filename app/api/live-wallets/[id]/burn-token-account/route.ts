import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { LiveWalletError, burnLiveWalletTokenAccount } from "@/db/live/service";

type Params = { params: Promise<{ id: string }> };
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Body: { account: string } - the token account to burn and close. Destroys any tokens it still holds, closes the account
 * and returns its rent deposit to the wallet, signed with the wallet's own key. Irreversible; the UI asks for confirmation first.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const account = typeof body?.account === "string" ? body.account.trim() : "";
  if (!ADDRESS_RE.test(account)) return NextResponse.json({ error: "A valid token account address is required" }, { status: 400 });

  try {
    const result = await burnLiveWalletTokenAccount(id, { userId: user.id, username: user.username, account });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof LiveWalletError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Failed to burn the token account" }, { status: 500 });
  }
}
