import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { getRunAddressPnl } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string; address: string }> };

/** Query: period? (day | week | month | all - default week), date? (YYYY-MM-DD, the last day covered; default the window's last day). */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id, address } = await params;
  const sp = request.nextUrl.searchParams;
  const rawPeriod = sp.get("period");
  const period = rawPeriod === "day" || rawPeriod === "month" || rawPeriod === "all" ? rawPeriod : "week";
  const date = sp.get("date");
  const pnl = await getRunAddressPnl(id, address, { period, date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined });
  if (!pnl) return NextResponse.json({ error: "Address not found in this backtest" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(pnl)));
}
