import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { SimPosition } from "@/db/models/SimPosition";
import { Trader } from "@/db/models/Trader";
import { markOpenPositions } from "@/db/simulation/positionsView";

/**
 * Every open simulated position across EVERY tracked trader, within one
 * profile - unlike /api/traders/[address]/positions, which is scoped to one
 * trader. Powers the header "open trades" banner (components/open-trades-
 * banner.tsx), which needs to show everything regardless of which trader
 * owns it. Live-priced the same way the per-trader route is (markOpenPositions).
 */
export async function GET(request: NextRequest) {
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });

  const rawPositions = await SimPosition.find({ profileId, status: "open" }).sort({ openedAt: -1 }).lean();
  const positions = await markOpenPositions(rawPositions);

  const addresses = [...new Set(positions.map((p) => p.traderAddress))];
  const traders = await Trader.find({ address: { $in: addresses } }, { address: 1, label: 1 }).lean();
  const labelByAddress = new Map(traders.map((t) => [t.address, t.label]));

  const withTrader = positions.map((p) => ({ ...p, traderLabel: labelByAddress.get(p.traderAddress) || "" }));

  return NextResponse.json({ positions: withTrader, total: withTrader.length });
}
