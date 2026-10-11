import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { controlBacktestRun, deleteBacktestRun, getBacktestRun } from "@/db/backtest/service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const detail = await getBacktestRun(id).catch(() => null);
  if (!detail) return NextResponse.json({ error: "Backtest not found" }, { status: 404 });
  return NextResponse.json(JSON.parse(JSON.stringify(detail)));
}

/** Body: { action: "pause" | "resume" | "cancel" | "retry_failed" } */
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const run = await controlBacktestRun(id, String(body.action));
    return NextResponse.json({ run: JSON.parse(JSON.stringify(run)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { id } = await params;
  try {
    await deleteBacktestRun(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 400 });
  }
}
