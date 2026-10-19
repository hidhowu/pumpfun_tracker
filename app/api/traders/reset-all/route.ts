import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { resetAllTradersSimulation } from "@/db/traderService";

/** Wipes simulation state for every active trader, within one profile, and resets each back to their starting allocation. Destructive - confirm on the client before calling. */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  try {
    const reset = await resetAllTradersSimulation(profileId);
    return NextResponse.json({ reset });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to reset traders" }, { status: 400 });
  }
}
