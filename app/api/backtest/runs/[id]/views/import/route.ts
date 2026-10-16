import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { importViews, previewImport } from "@/db/backtest/views";

type Params = { params: Promise<{ id: string }> };

/** ?sourceRunId=... : the combined backtests of that other backtest, each with how many of its addresses THIS backtest also has. */
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const sourceRunId = request.nextUrl.searchParams.get("sourceRunId") ?? "";
  try {
    return NextResponse.json(JSON.parse(JSON.stringify(await previewImport(id, sourceRunId))));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}

/**
 * Body: { sourceRunId: string, viewIds?: string[] (default: all of that backtest's views), allowPartial?: boolean }
 * Copies the definitions (name, addresses, settings) - never trades - onto this backtest, where they use this backtest's trades.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const res = await importViews(id, String(body.sourceRunId ?? ""), { viewIds: Array.isArray(body.viewIds) ? body.viewIds.map(String) : undefined, allowPartial: body.allowPartial === true });
    return NextResponse.json(JSON.parse(JSON.stringify(res)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}
