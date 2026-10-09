import { NextRequest, NextResponse } from "next/server";
import { changePassword } from "@/db/authService";
import { getSessionUser, requireApiSession, startSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";

/**
 * Body: { currentPassword, newPassword }. On success every session for this
 * account is signed out (other browsers included) and this browser gets a
 * fresh one.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  const body = await request.json().catch(() => ({}));

  const result = await changePassword(user.id, body.currentPassword, body.newPassword, { ip: clientIp(request.headers) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await startSession(user.id);
  return NextResponse.json({ ok: true });
}
