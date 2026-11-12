import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Trader } from "@/db/models/Trader";

/** How many traders are being tracked (not blacklisted) - the small count beside "Traders" in the sidebar. Read-only and cheap, unlike the full list. */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const count = await Trader.countDocuments({ status: "active" });
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
