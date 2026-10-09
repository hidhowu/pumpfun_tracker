import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { adjustBalance } from "@/db/traderService";
import { BalanceAdjustment } from "@/db/models/BalanceAdjustment";

type Params = { params: Promise<{ address: string }> };

/** Body: { "amountUsd": number, "reason"?: string }. amountUsd can be negative (a manual deduction). */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const body = await request.json().catch(() => ({}));

  const amountUsd = Number(body.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd === 0) {
    return NextResponse.json({ error: "amountUsd must be a non-zero number" }, { status: 400 });
  }

  try {
    const profileTrader = await adjustBalance(profileId, address, amountUsd, body.reason || "");
    return NextResponse.json({ balanceUsd: profileTrader.sim.balanceUsd });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to adjust balance" }, { status: 400 });
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const adjustments = await BalanceAdjustment.find({ profileId, traderAddress: address }).sort({ createdAt: -1 }).limit(50).lean();
  return NextResponse.json({ adjustments });
}
