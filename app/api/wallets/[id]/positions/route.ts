import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { WalletPosition } from "@/db/models/WalletPosition";
import { markOpenWalletPositions } from "@/db/simulation/walletPositionsView";

type Params = { params: Promise<{ id: string }> };

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CLOSE_REASONS = new Set(["trader_sell", "stop_loss", "take_profit", "bench", "trailing_stop", "max_hold_time", "blacklisted", "no_price"]);

/**
 * A wallet's simulated positions - both currently-open (live-priced) and
 * the full closed-trade history (nothing is ever deleted). Query with
 * ?status=open or ?status=closed to filter; omit for both. Mirrors
 * app/api/traders/[address]/positions/route.ts exactly, walletId-scoped.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "25")));

  const filter: Record<string, unknown> = { walletId: id };
  if (status === "open" || status === "closed") filter.status = status;

  // Optional narrowing for the trade-history table (read-only filters on closed positions):
  //   q = part of the mint or of the trader's address, result = win|loss, reason = a close reason
  const search = request.nextUrl.searchParams;
  const q = (search.get("q") || "").trim().slice(0, 64);
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ mint: rx }, { traderAddress: rx }];
  }
  const result = search.get("result");
  if (result === "win") filter.realizedPnlUsd = { $gt: 0 };
  else if (result === "loss") filter.realizedPnlUsd = { $lt: 0 };
  const reason = search.get("reason");
  if (reason && CLOSE_REASONS.has(reason)) filter.closeReason = reason;

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
