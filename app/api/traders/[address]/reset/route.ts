import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { Trader } from "@/db/models/Trader";
import { resetTraderSimulation } from "@/db/traderService";
import { resolveTraderDetailView } from "@/lib/traderView";

type Params = { params: Promise<{ address: string }> };

/** Wipes this trader's simulation state (positions, pending fills, P&L history) and resets balance back to their starting allocation. */
export async function POST(request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });

  try {
    await resetTraderSimulation(profileId, address);
    const trader = await Trader.findOne({ address });
    const view = await resolveTraderDetailView(profileId, trader!);
    return NextResponse.json({ trader: view });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to reset trader" }, { status: 400 });
  }
}
