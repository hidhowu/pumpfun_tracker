import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { enableTwoFactor } from "@/db/authService";
import { getSessionUser, requireApiSession, startSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";

/**
 * Body: { code }. Finishes turning two-factor on once the app produces a valid code. Returns the one-time recovery codes
 * (shown once). Every session - including this one - was created without a second factor, so all are ended and this browser
 * gets a fresh one.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  const body = await request.json().catch(() => ({}));
  await connectDb();

  const result = await enableTwoFactor(user.id, body.code, { ip: clientIp(request.headers) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await startSession(user.id);
  return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
}
