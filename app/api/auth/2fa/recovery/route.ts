import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { regenerateRecoveryCodes } from "@/db/authService";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";

/** Body: { password, code }. Replaces the recovery codes (the old ones stop working) and returns the new ones once. */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  const body = await request.json().catch(() => ({}));
  await connectDb();

  const result = await regenerateRecoveryCodes(user.id, body.password, body.code, { ip: clientIp(request.headers) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
}
