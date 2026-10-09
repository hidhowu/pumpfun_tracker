import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { authenticate } from "@/db/authService";
import { endSession, startSession } from "@/lib/auth/session";
import { clientIp, isSessionSecretConfigured } from "@/lib/auth/token";

/**
 * Body: { username, password }. The only API route reachable without a
 * session (see proxy.ts). Every failure is the same generic message - it
 * never says whether the username exists.
 */
export async function POST(request: NextRequest) {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json({ error: "Sign-in is not configured on this server (SESSION_SECRET missing)." }, { status: 500 });
  }
  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });

  await connectDb();
  const result = await authenticate(username, password, { ip: clientIp(request.headers) });
  if (!result.ok) {
    if (result.reason === "locked") {
      const seconds = Math.ceil(result.retryAfterMs / 1000);
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(seconds / 60)} min.` },
        { status: 429, headers: { "Retry-After": String(seconds) } }
      );
    }
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  // Always a brand-new session on sign-in, never a reused one (session fixation).
  await endSession();
  await startSession(result.user.id);
  return NextResponse.json({ ok: true });
}
