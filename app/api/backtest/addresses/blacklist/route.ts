import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { blacklistBacktestAddresses } from "@/db/backtest/service";

/**
 * Body: { addresses: string[] } - blacklists them on the platform's shared blacklist (so live trading and the backtest list both refuse them),
 * blacklists any that are active live traders too, and removes them from the backtest list.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body.addresses) ? body.addresses.filter((a: unknown) => typeof a === "string") : [];
  if (addresses.length === 0) return NextResponse.json({ error: "Provide 'addresses' (a non-empty array)." }, { status: 400 });
  const result = await blacklistBacktestAddresses(addresses);
  return NextResponse.json(result);
}
