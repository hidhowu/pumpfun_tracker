import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { promoteToLiveTraders } from "@/db/backtest/service";

/** Body: { addresses: string[] } - adds them to the live Traders list (duplicates skipped, blacklisted ones stay blacklisted). */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body.addresses) ? body.addresses.filter((a: unknown) => typeof a === "string") : [];
  if (addresses.length === 0) return NextResponse.json({ error: "Provide 'addresses' (a non-empty array)." }, { status: 400 });
  const result = await promoteToLiveTraders(addresses);
  return NextResponse.json(result);
}
