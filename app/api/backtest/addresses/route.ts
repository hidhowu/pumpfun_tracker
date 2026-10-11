import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { addBacktestAddresses, listBacktestAddresses } from "@/db/backtest/service";

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const addresses = await listBacktestAddresses();
  return NextResponse.json({ addresses: JSON.parse(JSON.stringify(addresses)) });
}

/** Body: { entries: Array<string | { address: string, label?: string }> } - duplicates are skipped, malformed addresses reported. */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) return NextResponse.json({ error: "Provide 'entries' (a non-empty array)." }, { status: 400 });
  const result = await addBacktestAddresses(entries);
  return NextResponse.json(result);
}
