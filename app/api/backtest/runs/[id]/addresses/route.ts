import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { addAddressesToRun } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string }> };

/**
 * Adds addresses to a backtest that already exists (running, queued, paused or finished). Either
 *   { addresses: string[] }  - at most 10,000 (the page sends 5,000), all on the backtest list; or
 *   { fromList: true, afterId?: string, search?: string, limit?: number } - everything on the backtest list that is not in the backtest yet, one page
 *     per call: send back the `nextAfterId` of the answer until it is null.
 * A finished backtest becomes paused: Resume then works only through the new addresses.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const result = await addAddressesToRun(id, {
      addresses: Array.isArray(body.addresses) ? body.addresses.filter((a: unknown) => typeof a === "string") : [],
      fromList: body.fromList === true,
      afterId: typeof body.afterId === "string" && body.afterId ? body.afterId : null,
      search: typeof body.search === "string" ? body.search : "",
      limit: Number(body.limit) || undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to add the addresses" }, { status: 400 });
  }
}
