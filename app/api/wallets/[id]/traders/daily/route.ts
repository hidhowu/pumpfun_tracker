import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { WalletTrader } from "@/db/models/WalletTrader";
import { Trader } from "@/db/models/Trader";
import { computeWalletTradersDailyPnl } from "@/db/walletPnl";
import type { WalletTraderDay } from "@/lib/types";

const DAYS = 7;

type Params = { params: Promise<{ id: string }> };

/**
 * Detailed "Traders Performance": every trader assigned to this wallet with
 * their realized P&L and trade count for each of the last 7 UTC days (today
 * included). Scoped to trades made on THIS wallet only, like the rest of the
 * Traders Performance tab.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;

  const [walletTraders, { dates, traders }] = await Promise.all([
    WalletTrader.find({ walletId: id }).sort({ addedAt: -1 }).lean(),
    computeWalletTradersDailyPnl(id, DAYS),
  ]);
  const traderDocs = await Trader.find({ address: { $in: walletTraders.map((wt) => wt.traderAddress) } }, { address: 1, label: 1 }).lean();
  const labelByAddress = new Map(traderDocs.map((t) => [t.address, t.label]));

  const dailyByAddress = traders as Record<string, WalletTraderDay[]>;
  const rows = walletTraders.map((wt) => {
    const daily = dailyByAddress[wt.traderAddress] ?? dates.map((date: string) => ({ date, pnlUsd: 0, tradeCount: 0, wins: 0, losses: 0 }));
    return {
      traderAddress: wt.traderAddress,
      label: labelByAddress.get(wt.traderAddress) || "",
      daily,
      totalPnlUsd: daily.reduce((sum, d) => sum + d.pnlUsd, 0),
      totalTrades: daily.reduce((sum, d) => sum + d.tradeCount, 0),
      totalWins: daily.reduce((sum, d) => sum + d.wins, 0),
      totalLosses: daily.reduce((sum, d) => sum + d.losses, 0),
    };
  });

  return NextResponse.json({ dates, traders: rows });
}
