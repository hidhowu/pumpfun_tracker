import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { SimPosition } from "@/db/models/SimPosition";
import { markOpenPositions } from "@/db/simulation/positionsView";

type Params = { params: Promise<{ address: string }> };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CLOSE_REASONS = new Set(["trader_sell", "stop_loss", "take_profit", "bench", "trailing_stop", "max_hold_time", "blacklisted", "no_price"]);

/**
 * Our simulated positions for this trader - both the currently-open ones
 * and the full closed-trade history (nothing is ever deleted). Query with
 * ?status=open or ?status=closed to filter; omit for both. Open positions
 * are live-priced (currentPriceUsd/currentValueUsd/unrealizedPnlUsd/Percent)
 * so the UI can show at-a-glance profit/loss; closed positions already have
 * their realized numbers stored on the document.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || "25")));

  const filter: Record<string, unknown> = { profileId, traderAddress: address };
  if (status === "open" || status === "closed") filter.status = status;

  // Optional narrowing for the trade-history table (all read-only filters on closed positions):
  //   q = part of the mint, result = win|loss, reason = a close reason, from/to = closed on or between these UTC days (YYYY-MM-DD)
  const search = request.nextUrl.searchParams;
  const q = (search.get("q") || "").trim().slice(0, 64);
  if (q) filter.mint = { $regex: escapeRegex(q), $options: "i" };
  const result = search.get("result");
  if (result === "win") filter.realizedPnlUsd = { $gt: 0 };
  else if (result === "loss") filter.realizedPnlUsd = { $lt: 0 };
  const reason = search.get("reason");
  if (reason && CLOSE_REASONS.has(reason)) filter.closeReason = reason;
  const from = search.get("from");
  const to = search.get("to");
  const closedRange: Record<string, Date> = {};
  if (from && DAY_RE.test(from)) closedRange.$gte = new Date(`${from}T00:00:00.000Z`);
  if (to && DAY_RE.test(to)) closedRange.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
  if (Object.keys(closedRange).length > 0) filter.closedAt = closedRange;

  const dir = search.get("dir") === "asc" ? 1 : -1;
  const sortField = status === "open" ? "openedAt" : search.get("sort") === "pnl" ? "realizedPnlUsd" : "closedAt";
  const [rawPositions, total] = await Promise.all([
    SimPosition.find(filter)
      .sort({ [sortField]: dir, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    SimPosition.countDocuments(filter),
  ]);

  const positions = status === "open" ? await markOpenPositions(rawPositions) : rawPositions;

  return NextResponse.json({ positions, page, limit, total, totalPages: Math.ceil(total / limit) });
}
