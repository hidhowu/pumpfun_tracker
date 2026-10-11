import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { importTradersToBacktest } from "@/db/backtest/service";

/** Body: { listId?: string } - copies the live active traders (or just one list's) onto the backtest list. */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  const result = await importTradersToBacktest({ listId: typeof body.listId === "string" ? body.listId : undefined });
  return NextResponse.json(result);
}
