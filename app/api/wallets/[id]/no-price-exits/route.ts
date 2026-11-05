import { NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { WalletPosition } from "@/db/models/WalletPosition";

type Params = { params: Promise<{ id: string }> };

/**
 * The wallet's positions that nothing could price: sold because the tracking server's /price found no price at all ("no_price" close), and the ones still
 * open that have gone without any price (their sale could not be priced either). So a token that keeps getting through unpriced is seen, with the trader
 * who bought it, instead of silently costing money. Newest first, at most 100; `total` counts all of them.
 */
export async function GET(_request: Request, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;

  const filter = {
    walletId: id,
    $or: [{ status: "closed", closeReason: "no_price" }, { status: "open", "apiPlus.noPriceSinceSec": { $ne: null } }],
  };
  const [rows, total] = await Promise.all([
    WalletPosition.find(filter, { mint: 1, traderAddress: 1, status: 1, openedAt: 1, closedAt: 1, realizedPnlUsd: 1, realizedPnlPercent: 1, closeTrigger: 1, "apiPlus.noPriceSinceSec": 1 })
      .sort({ openedAt: -1 })
      .limit(100)
      .lean(),
    WalletPosition.countDocuments(filter),
  ]);

  const positions = rows.map((p) => ({
    id: String(p._id),
    mint: p.mint,
    traderAddress: p.traderAddress,
    status: p.status,
    openedAt: p.openedAt,
    closedAt: p.closedAt ?? null,
    realizedPnlUsd: p.realizedPnlUsd ?? null,
    realizedPnlPercent: p.realizedPnlPercent ?? null,
    reason: (p.closeTrigger as { reason?: string } | null)?.reason ?? null,
    noPriceSinceSec: (p.apiPlus as { noPriceSinceSec?: number | null } | null)?.noPriceSinceSec ?? null,
  }));
  return NextResponse.json({ total, positions });
}
