import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { MAX_ADD_REQUEST, promoteToLiveTraders } from "@/db/backtest/service";

/**
 * Body: { addresses: string[] (at most 10,000; the page sends 5,000), listId?: string } - adds them to the live Traders list (duplicates skipped, blacklisted ones stay
 * blacklisted) and, if a listId is given, tags them (the new ones and the ones already tracked) into that trader list.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const addresses: string[] = Array.isArray(body.addresses) ? body.addresses.filter((a: unknown) => typeof a === "string") : [];
  if (addresses.length === 0) return NextResponse.json({ error: "Provide 'addresses' (a non-empty array)." }, { status: 400 });
  if (addresses.length > MAX_ADD_REQUEST) {
    return NextResponse.json({ error: `Send at most ${MAX_ADD_REQUEST} addresses per request (got ${addresses.length}) - add them in batches.` }, { status: 413 });
  }
  const result = await promoteToLiveTraders(addresses, { listId: typeof body.listId === "string" && body.listId ? body.listId : undefined });
  return NextResponse.json(result);
}
