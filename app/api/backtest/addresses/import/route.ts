import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { importTradersToBacktest } from "@/db/backtest/service";

/**
 * Body: { listId?: string, afterId?: string } - copies the live active traders (or just one list's) onto the backtest list, ONE PAGE per call:
 * send back the `nextAfterId` of the answer until it is null. `total` (first page) is how many there are.
 */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const result = await importTradersToBacktest({
    listId: typeof body.listId === "string" ? body.listId : undefined,
    afterId: typeof body.afterId === "string" && body.afterId ? body.afterId : null,
  });
  return NextResponse.json(result);
}
