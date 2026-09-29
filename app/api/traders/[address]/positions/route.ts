import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { SimPosition } from "@/db/models/SimPosition";
import { markOpenPositions } from "@/db/simulation/positionsView";

type Params = { params: Promise<{ address: string }> };

/**
 * Our simulated positions for this trader - both the currently-open ones
 * and the full closed-trade history (nothing is ever deleted). Query with
 * ?status=open or ?status=closed to filter; omit for both. Open positions
 * are live-priced (currentPriceUsd/currentValueUsd/unrealizedPnlUsd/Percent)
 * so the UI can show at-a-glance profit/loss; closed positions already have
 * their realized numbers stored on the document.
 */
export async function GET(request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "25")));

  const filter: Record<string, unknown> = { profileId, traderAddress: address };
  if (status === "open" || status === "closed") filter.status = status;

  const sortField = status === "open" ? "openedAt" : "closedAt";
  const [rawPositions, total] = await Promise.all([
    SimPosition.find(filter)
      .sort({ [sortField]: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SimPosition.countDocuments(filter),
  ]);

  const positions = status === "open" ? await markOpenPositions(rawPositions) : rawPositions;

  return NextResponse.json({ positions, page, limit, total, totalPages: Math.ceil(total / limit) });
}
