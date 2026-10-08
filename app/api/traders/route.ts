import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { Trader } from "@/db/models/Trader";
import { addTradersBulk } from "@/db/traderService";
import { resolveTraderViews } from "@/lib/traderView";

export async function GET(request: NextRequest) {
  await connectDb();
  const status = request.nextUrl.searchParams.get("status"); // "active" | "blacklisted" | null (all)
  const listId = request.nextUrl.searchParams.get("listId"); // narrows to one TraderList's members, or null (all)
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });

  const query: Record<string, unknown> = {};
  if (status) query.status = status;
  if (listId) query.listIds = listId;
  const traders = await Trader.find(query).sort({ addedAt: -1 }).lean();
  const views = await resolveTraderViews(profileId, traders);

  return NextResponse.json({ traders: views });
}

/**
 * Add one or many traders. Body can be:
 *   { "address": "...", "label": "optional" }
 *   { "addresses": ["...", "...", { "address": "...", "label": "..." }] }
 * Duplicates (already-tracked addresses, including repeats within the same
 * request) are silently skipped - never an error - and returned in `skipped`.
 * Blacklisted addresses are skipped too (never re-activated) and returned in
 * `blacklisted`.
 */
export async function POST(request: NextRequest) {
  await connectDb();
  const body = await request.json().catch(() => ({}));

  const entries: Array<string | { address: string; label?: string }> = body.addresses
    ? body.addresses
    : body.address
      ? [{ address: body.address, label: body.label }]
      : [];

  if (entries.length === 0) {
    return NextResponse.json({ error: "Provide 'address' or 'addresses'." }, { status: 400 });
  }

  const { added, skipped, blacklisted, invalid } = await addTradersBulk(entries);
  return NextResponse.json({ added, skipped, blacklisted, invalid });
}
