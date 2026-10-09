import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { WalletTrader } from "@/db/models/WalletTrader";
import { Trader } from "@/db/models/Trader";
import { Wallet } from "@/db/models/Wallet";
import { addTradersToWallet, removeTradersFromWallet } from "@/db/walletService";
import { computeWalletTraderPnl } from "@/db/walletPnl";

const PERIOD_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

type Params = { params: Promise<{ id: string }> };

/**
 * Assigned traders + their per-wallet "Traders Performance" stats.
 * ?period=day|week|month (default day) adds a period-scoped P&L figure
 * alongside the always-present lifetime-since-added numbers. Every figure
 * here is scoped ONLY to trades made while this trader has been assigned to
 * THIS wallet - never the trader's overall/lifetime performance elsewhere
 * in the app. A trader just added starts at zero, regardless of how
 * they've done anywhere else.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const period = request.nextUrl.searchParams.get("period") || "day";
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.day;

  const walletTraders = await WalletTrader.find({ walletId: id }).sort({ addedAt: -1 }).lean();
  const addresses = walletTraders.map((wt) => wt.traderAddress);
  const traderDocs = await Trader.find({ address: { $in: addresses } }, { address: 1, label: 1 }).lean();
  const labelByAddress = new Map(traderDocs.map((t) => [t.address, t.label]));

  const traders = await Promise.all(
    walletTraders.map(async (wt) => {
      const periodPnl = await computeWalletTraderPnl(id, wt.traderAddress, days);
      return {
        traderAddress: wt.traderAddress,
        label: labelByAddress.get(wt.traderAddress) || "",
        addedAt: wt.addedAt,
        lifetimeTrades: wt.openPositionCount + wt.closedPositionCount,
        lifetimeRealizedPnlUsd: wt.realizedPnlUsd,
        openPositionCount: wt.openPositionCount,
        closedPositionCount: wt.closedPositionCount,
        lastActionAt: wt.lastActionAt,
        periodPnlUsd: periodPnl.combinedUsd,
        periodTradeCount: periodPnl.closedTradeCount,
        periodWins: periodPnl.wins,
        periodLosses: periodPnl.losses,
      };
    })
  );

  return NextResponse.json({ period, traders });
}

/**
 * Body: { addresses: string[], trackNew?: boolean } - assigns every given
 * ACTIVE tracked trader to this wallet (no-op for ones already assigned).
 * Blacklisted addresses are always skipped. trackNew: true also starts
 * tracking any address not on the platform yet, then assigns it. See
 * db/walletService.js's addTradersToWallet for the response shape.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body.addresses) ? body.addresses : [];
  if (addresses.length === 0) return NextResponse.json({ error: "Provide 'addresses' (a non-empty array)." }, { status: 400 });
  if (!(await Wallet.exists({ _id: id }))) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });

  const result = await addTradersToWallet(id, addresses, { trackNew: body.trackNew === true });
  return NextResponse.json(result);
}

/** Body: { addresses: string[] } - unassigns every given address. Their existing WalletPositions are left as-is. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body.addresses) ? body.addresses : [];
  if (addresses.length === 0) return NextResponse.json({ error: "Provide 'addresses' (a non-empty array)." }, { status: 400 });

  const removedCount = await removeTradersFromWallet(id, addresses);
  return NextResponse.json({ removedCount });
}
