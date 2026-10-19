import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getTwoFactorStatus } from "@/db/authService";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";

/** Whether two-factor sign-in is on for the signed-in account, and how many recovery codes are left. */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  await connectDb();
  return NextResponse.json(await getTwoFactorStatus(user.id), { headers: { "Cache-Control": "no-store" } });
}
