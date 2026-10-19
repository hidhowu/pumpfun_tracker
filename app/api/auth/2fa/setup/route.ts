import { NextRequest, NextResponse } from "next/server";
import qrcode from "qrcode-generator";
import { connectDb } from "@/db/connect";
import { beginTwoFactorSetup } from "@/db/authService";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { clientIp } from "@/lib/auth/token";

/**
 * Body: { password }. Starts turning two-factor on: returns a new secret (as text and as a QR code) for the authenticator
 * app. Nothing is active until /api/auth/2fa/enable is called with a code from the app.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  const body = await request.json().catch(() => ({}));
  await connectDb();

  const result = await beginTwoFactorSetup(user.id, body.password, { ip: clientIp(request.headers) });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const qr = qrcode(0, "M");
  qr.addData(result.otpauthUrl);
  qr.make();
  return NextResponse.json(
    { secret: result.secret, otpauthUrl: result.otpauthUrl, qrSvg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
