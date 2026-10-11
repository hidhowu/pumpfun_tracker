import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { createBacktestRun, listBacktestRuns } from "@/db/backtest/service";

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const runs = await listBacktestRuns();
  return NextResponse.json({ runs: JSON.parse(JSON.stringify(runs)) });
}

/** Body: { name?: string, days: number, profileId: string, addresses: string[], maxSignatures?: number (0 = no limit, default 50,000) } */
export async function POST(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  try {
    const run = await createBacktestRun({
      name: typeof body.name === "string" ? body.name : "",
      days: Number(body.days),
      profileId: String(body.profileId || ""),
      addresses: Array.isArray(body.addresses) ? body.addresses.filter((a: unknown) => typeof a === "string") : [],
      ...(body.maxSignatures !== undefined ? { maxSignatures: Number(body.maxSignatures) } : {}),
    });
    return NextResponse.json({ run: JSON.parse(JSON.stringify(run)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create backtest" }, { status: 400 });
  }
}
