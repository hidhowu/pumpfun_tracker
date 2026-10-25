import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getSessionUser, requireApiSession } from "@/lib/auth/session";
import { isObjectIdString } from "@/db/settingsLimits";
import { TradingError, createLookupTable } from "@/db/live/trading/service";

type Params = { params: Promise<{ id: string }> };

/**
 * Creates the wallet's address lookup table now (or tops it up), so the first trade doesn't have to. Spends about 0.01-0.02 SOL of rent from
 * the wallet. Can take up to a minute: the table is filled with the accounts of a few sample markets and confirmed on the chain.
 */
export const maxDuration = 120;

export async function POST(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  const user = (await getSessionUser())!;
  await connectDb();
  const { id } = await params;
  if (!isObjectIdString(id)) return NextResponse.json({ error: "Wallet not found" }, { status: 404 });
  try {
    return NextResponse.json(await createLookupTable(id, { userId: user.id, username: user.username }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof TradingError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? `Couldn't create the lookup table: ${err.message.slice(0, 200)}` : "Couldn't create the lookup table" }, { status: 500 });
  }
}
