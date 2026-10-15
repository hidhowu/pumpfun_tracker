import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { MAX_ADD_REQUEST, addBacktestAddresses, listBacktestAddresses } from "@/db/backtest/service";

/** Query: page?, limit? (max 200), search? (text in the address or label), idsOnly=1 (just the addresses that match the search - to select them all), with skip + count for a slice of them (rows skip+1 ... skip+count). */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const sp = request.nextUrl.searchParams;
  const result = await listBacktestAddresses({
    page: Number(sp.get("page")) || 1,
    limit: Number(sp.get("limit")) || 50,
    search: sp.get("search") ?? "",
    idsOnly: sp.get("idsOnly") === "1",
    skip: Number(sp.get("skip")) || 0,
    count: Number(sp.get("count")) || undefined,
  });
  return NextResponse.json(JSON.parse(JSON.stringify(result)));
}

/**
 * Body: { entries: Array<string | { address: string, label?: string, userId?: string }> } - duplicates are skipped, malformed addresses reported.
 * At most MAX_ADD_REQUEST entries per request: the page sends a big paste in batches.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (entries.length === 0) return NextResponse.json({ error: "Provide 'entries' (a non-empty array)." }, { status: 400 });
  if (entries.length > MAX_ADD_REQUEST) {
    return NextResponse.json({ error: `Send at most ${MAX_ADD_REQUEST} entries per request (got ${entries.length}) - add them in batches.` }, { status: 413 });
  }
  const result = await addBacktestAddresses(entries);
  return NextResponse.json(result);
}
