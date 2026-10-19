import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { verifyTwoFactorLogin } from "@/db/authService";
import { endSession, startSession } from "@/lib/auth/session";
import { clientIp, isSessionSecretConfigured, verifyTwoFactorChallenge } from "@/lib/auth/token";

/**
 * Second step of a two-factor sign-in. Body: { challenge, code } - the challenge from /api/auth/login plus an
 * authenticator code (or a recovery code). Public like /api/auth/login (see proxy.ts) because there is no session yet;
 * it is useless without a valid challenge, and wrong codes are throttled per account and per IP.
 */
export async function POST(request: NextRequest) {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json({ error: "Sign-in is not configured on this server (SESSION_SECRET missing)." }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const userId = verifyTwoFactorChallenge(body.challenge);
  if (!userId) return NextResponse.json({ error: "This sign-in expired. Enter your password again.", expired: true }, { status: 401 });
  const code = typeof body.code === "string" ? body.code.slice(0, 32) : "";
  if (!code) return NextResponse.json({ error: "Enter the code from your authenticator app." }, { status: 400 });

  await connectDb();
  const result = await verifyTwoFactorLogin(userId, code, { ip: clientIp(request.headers) });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status, ...(result.status === 429 ? { headers: { "Retry-After": "60" } } : {}) });
  }

  await endSession(); // always a brand-new session (session fixation)
  await startSession(result.user.id);
  return NextResponse.json({ ok: true, usedRecoveryCode: result.usedRecoveryCode });
}
