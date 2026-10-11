import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { listOverview } from "@/db/listPnl";

/** ?profileId= - every list with its headline performance on that profile (drives the /lists page). */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const lists = await listOverview(profileId);
  return NextResponse.json({ lists: JSON.parse(JSON.stringify(lists)) });
}
