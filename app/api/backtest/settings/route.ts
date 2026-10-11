import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { resolveBacktestSettings, updateBacktestSettings } from "@/db/backtest/settings";

/** Stored values (null = auto), the effective values currently in use, and the proxy/RPC capacity they were derived from. */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  return NextResponse.json(JSON.parse(JSON.stringify(await resolveBacktestSettings())));
}

/** Body: any subset of the stored fields; null resets an auto-able field to auto. */
export async function PUT(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const body = await request.json().catch(() => ({}));
  return NextResponse.json(JSON.parse(JSON.stringify(await updateBacktestSettings(body))));
}
