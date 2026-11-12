import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { SimPosition } from "@/db/models/SimPosition";

type Params = { params: Promise<{ address: string }> };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Realized P&L of this trader's simulated trades for ONE UTC day, per hour of that day (by the time each trade closed):
 * ?profileId=...&date=YYYY-MM-DD. Read-only; drives the day detail in the P&L tab's daily results calendar.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  const date = request.nextUrl.searchParams.get("date");
  if (!profileId || !mongoose.isValidObjectId(profileId)) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  if (!date || !DAY_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const rows: { _id: number; pnlUsd: number; trades: number }[] = await SimPosition.aggregate([
    { $match: { profileId: new mongoose.Types.ObjectId(profileId), traderAddress: address, status: "closed", closedAt: { $gte: dayStart, $lt: dayEnd } } },
    { $group: { _id: { $hour: "$closedAt" }, pnlUsd: { $sum: "$realizedPnlUsd" }, trades: { $sum: 1 } } },
  ]);
  const byHour = new Map(rows.map((r) => [r._id, r]));
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    pnlUsd: Math.round((byHour.get(hour)?.pnlUsd ?? 0) * 100) / 100,
    trades: byHour.get(hour)?.trades ?? 0,
  }));
  return NextResponse.json({ date, hours });
}
