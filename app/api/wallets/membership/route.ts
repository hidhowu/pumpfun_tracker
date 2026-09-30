import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { WalletTrader } from "@/db/models/WalletTrader";

/** ?traderAddress= - every walletId this trader is currently assigned to. Cheap membership check for the per-trader "Add to Wallet" menu, since wallet membership lives in a separate join collection (WalletTrader), not a field on Trader like listIds. */
export async function GET(request: NextRequest) {
  await connectDb();
  const traderAddress = request.nextUrl.searchParams.get("traderAddress");
  if (!traderAddress) return NextResponse.json({ error: "traderAddress is required" }, { status: 400 });

  const rows = await WalletTrader.find({ traderAddress }, { walletId: 1 }).lean();
  return NextResponse.json({ walletIds: rows.map((r) => String(r.walletId)) });
}
