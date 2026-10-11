import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { getRunDaily } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const daily = await getRunDaily(id).catch(() => null);
  if (!daily) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(daily)));
}
