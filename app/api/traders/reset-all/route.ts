import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { resetAllTradersSimulation } from "@/db/traderService";

/** Wipes simulation state for every active trader, within one profile, and resets each back to their starting allocation. Destructive - confirm on the client before calling. */
export async function POST(request: NextRequest) {
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const reset = await resetAllTradersSimulation(profileId);
  return NextResponse.json({ reset });
}
