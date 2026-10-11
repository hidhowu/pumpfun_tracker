import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Trader } from "@/db/models/Trader";
import { computeListTradersDaily, getListAddresses } from "@/db/listPnl";

type Params = { params: Promise<{ id: string }> };

/**
 * ?profileId= (required). Every trader in the list with their realized P&L per
 * day for the last 7 UTC days, plus their overall (all-time) totals on that profile.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });

  const addresses = await getListAddresses(id);
  const [{ dates, dailyByTrader, overallByTrader }, traderDocs] = await Promise.all([
    computeListTradersDaily(profileId, addresses),
    Trader.find({ address: { $in: addresses } }, { address: 1, label: 1 }).sort({ addedAt: -1 }).lean(),
  ]);

  const traders = traderDocs.map((t) => {
    const daily = dailyByTrader.get(t.address) ?? dates.map((date: string) => ({ date, pnlUsd: 0, tradeCount: 0, wins: 0, losses: 0 }));
    const o = overallByTrader.get(t.address);
    return {
      traderAddress: t.address,
      label: t.label || "",
      daily,
      totalPnlUsd: daily.reduce((sum: number, d: { pnlUsd: number }) => sum + d.pnlUsd, 0),
      totalTrades: daily.reduce((sum: number, d: { tradeCount: number }) => sum + d.tradeCount, 0),
      totalWins: daily.reduce((sum: number, d: { wins: number }) => sum + d.wins, 0),
      totalLosses: daily.reduce((sum: number, d: { losses: number }) => sum + d.losses, 0),
      overall: { pnlUsd: o?.pnlUsd ?? 0, trades: o?.trades ?? 0, wins: o?.wins ?? 0, losses: o?.losses ?? 0 },
    };
  });
  return NextResponse.json({ dates, traders });
}
