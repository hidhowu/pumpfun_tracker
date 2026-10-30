import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { getDryDaily } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/** What each dry-run exit style made per day (UTC) over the last 7 days, in dollars. */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const daily = await getDryDaily(id);
  if (!daily) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json(daily, { headers: { "Cache-Control": "no-store" } });
}
