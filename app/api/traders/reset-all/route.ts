import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { resetAllTradersSimulation } from "@/db/traderService";

/** Wipes simulation state for every active trader and resets each back to their starting allocation. Destructive - confirm on the client before calling. */
export async function POST() {
  await connectDb();
  const reset = await resetAllTradersSimulation();
  return NextResponse.json({ reset });
}
