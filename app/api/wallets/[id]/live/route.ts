import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { getLinkedLive } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/** The live wallet connected to this simulation wallet (or { link: null }), with its balance and how its copied trades did. */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json({ link: await getLinkedLive(id) }, { headers: { "Cache-Control": "no-store" } });
}
