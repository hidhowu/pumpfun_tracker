import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { listLots } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/** Query: status? (open | closed), page?, limit? (max 100). Each trade with the simulation's matching position beside it. */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  const sp = request.nextUrl.searchParams;
  const status = sp.get("status");
  const result = await listLots(id, {
    status: status === "open" || status === "closed" ? status : null,
    page: Number(sp.get("page")) || 1,
    limit: Number(sp.get("limit")) || 25,
  });
  if (!result) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
