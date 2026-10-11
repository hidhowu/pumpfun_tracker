import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { listRunPositions } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string }> };

/** Query: address?, status? (closed | open | skipped - the default is closed + open), page?, limit? */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 25));
  const result = await listRunPositions(id, {
    address: sp.get("address") || undefined,
    status: sp.get("status") || undefined,
    page: Math.max(1, Number(sp.get("page")) || 1),
    limit,
  });
  return NextResponse.json(JSON.parse(JSON.stringify(result)));
}
