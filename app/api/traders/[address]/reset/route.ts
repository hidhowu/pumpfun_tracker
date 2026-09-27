import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { resetTraderSimulation } from "@/db/traderService";
import { resolveTraderDetailView } from "@/lib/traderView";

type Params = { params: Promise<{ address: string }> };

/** Wipes this trader's simulation state (positions, pending fills, P&L history) and resets balance back to their starting allocation. */
export async function POST(_request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;

  try {
    const trader = await resetTraderSimulation(address);
    const view = await resolveTraderDetailView(trader!);
    return NextResponse.json({ trader: view });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to reset trader" }, { status: 400 });
  }
}
