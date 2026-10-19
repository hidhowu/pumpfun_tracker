import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { disableTwoFactor } from "@/db/authService";
import { getSessionUser, requireApiSession, startSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";

/** Body: { password, code }. Turns two-factor off; needs the password AND a current code (or a recovery code). */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  const body = await request.json().catch(() => ({}));
  await connectDb();

  const result = await disableTwoFactor(user.id, body.password, body.code, { ip: clientIp(request.headers) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
