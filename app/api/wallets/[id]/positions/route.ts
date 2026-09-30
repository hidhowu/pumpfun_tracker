import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { WalletPosition } from "@/db/models/WalletPosition";
import { markOpenWalletPositions } from "@/db/simulation/walletPositionsView";

type Params = { params: Promise<{ id: string }> };

/**
 * A wallet's simulated positions - both currently-open (live-priced) and
 * the full closed-trade history (nothing is ever deleted). Query with
 * ?status=open or ?status=closed to filter; omit for both. Mirrors
 * app/api/traders/[address]/positions/route.ts exactly, walletId-scoped.
 */
export async function GET(request: NextRequest, { params }: Params) {
  await connectDb();
  const { id } = await params;
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "25")));

  const filter: Record<string, unknown> = { walletId: id };
  if (status === "open" || status === "closed") filter.status = status;

  const sortField = status === "open" ? "openedAt" : "closedAt";
  const [rawPositions, total] = await Promise.all([
    WalletPosition.find(filter)
      .sort({ [sortField]: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WalletPosition.countDocuments(filter),
  ]);

  const positions = status === "open" ? await markOpenWalletPositions(rawPositions) : rawPositions;

  return NextResponse.json({ positions, page, limit, total, totalPages: Math.ceil(total / limit) });
}
