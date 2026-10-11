import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { getRunEquity } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string }> };

/** Query: address? - omit for the whole run. */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const equity = await getRunEquity(id, { address: request.nextUrl.searchParams.get("address") || undefined });
  return NextResponse.json(JSON.parse(JSON.stringify(equity)));
}
