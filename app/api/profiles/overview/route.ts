import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { listProfilesOverview } from "@/db/profileService";

/** Every profile with its headline numbers (P&L, open trades, balance, win rate) - drives the /profiles page. */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const profiles = await listProfilesOverview();
  return NextResponse.json({ profiles: JSON.parse(JSON.stringify(profiles)) });
}
