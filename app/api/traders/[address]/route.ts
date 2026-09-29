import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { Trader } from "@/db/models/Trader";
import { setBlacklisted, setMuted, setTraderMeta } from "@/db/traderService";
import { resolveTraderDetailView } from "@/lib/traderView";

type Params = { params: Promise<{ address: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });

  const trader = await Trader.findOne({ address });
  if (!trader) return NextResponse.json({ error: "Trader not found" }, { status: 404 });

  const view = await resolveTraderDetailView(profileId, trader);
  return NextResponse.json({ trader: view });
}

/**
 * Partial update. Body may include any of:
 *   { "status": "active" | "blacklisted" }   - blacklist / unblacklist
 *   { "muted": true | false | null }         - null clears the override (inherit global default)
 *   { "label": "...", "notes": "..." }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const body = await request.json().catch(() => ({}));

  const existing = await Trader.findOne({ address });
  if (!existing) return NextResponse.json({ error: "Trader not found" }, { status: 404 });

  if (body.status !== undefined) {
    if (!["active", "blacklisted"].includes(body.status)) {
      return NextResponse.json({ error: "status must be 'active' or 'blacklisted'" }, { status: 400 });
    }
    await setBlacklisted(address, body.status === "blacklisted");
  }

  if (body.muted !== undefined) {
    await setMuted(address, body.muted);
  }

  if (body.label !== undefined || body.notes !== undefined) {
    await setTraderMeta(address, { label: body.label, notes: body.notes });
  }

  const updated = await Trader.findOne({ address });
  const view = await resolveTraderDetailView(profileId, updated!);
  return NextResponse.json({ trader: view });
}
