import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/session";

/** Ends this browser's session server-side (not just the cookie). */
export async function POST() {
  await endSession();
  return NextResponse.json({ ok: true });
}
