import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { getRunAddress } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string; address: string }> };

/** One address of a backtest: its progress, stats and simulated wallet. */
export async function GET(_request: Request, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id, address } = await params;
  const detail = await getRunAddress(id, address);
  if (!detail) return NextResponse.json({ error: "Address not found in this backtest" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(detail)));
}
