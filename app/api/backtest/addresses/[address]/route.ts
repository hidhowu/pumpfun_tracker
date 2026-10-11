import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { updateBacktestAddress } from "@/db/backtest/service";

type Params = { params: Promise<{ address: string }> };

/** Body: { label?: string, notes?: string } */
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { address } = await params;
  const body = await request.json().catch(() => ({}));
  const updated = await updateBacktestAddress(address, { label: body.label, notes: body.notes });
  if (!updated) return NextResponse.json({ error: "Address not found" }, { status: 404 });
  return NextResponse.json({ address: JSON.parse(JSON.stringify(updated)) });
}
