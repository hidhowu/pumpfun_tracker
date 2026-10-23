import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { createBacktestRun, getQueuePosition, listBacktestRuns } from "@/db/backtest/service";

/** Optional ?address=: only the backtests that contain that address (a full address, or the start of one). */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const runs = await listBacktestRuns({ address: request.nextUrl.searchParams.get("address") ?? "" });
  return NextResponse.json({ runs: JSON.parse(JSON.stringify(runs)) });
}

/** Body: { name?: string, days: number, profileId: string, addresses: string[] (or allAddresses: true [+ search?: string] = everything on the backtest list, read by the server), maxSignatures?: number (0 = no limit, default 50,000), overrides?: { executionDelaySeconds?, riskCheckIntervalSeconds?, fillLatencySeconds? }, earlyStop?: { lossDays?, dayLossPercent?, negativeBalanceEvents?, lossAtProgressPercent? } (0 = rule off), addressParallelism?: number | null (null = automatic), daysAtOnce?: number (days of one address worked at once, 0 = no limit), collectMethod?: "api" | "rpc" (api = pump.fun user-trades, fast but limited history; rpc = read the chain, slow but reaches further back), mode?: "separate" | "combined", combined?: { startingBalanceUsd, resetDaily?, allowNegativeBalance? } (combined: the trade amount and fees go in overrides as tradeSizeUsd / pumpFeePercent / jitoFeeUsd) } */
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
      ...(body.allAddresses === true ? { allAddresses: true, search: typeof body.search === "string" ? body.search : "" } : {}),
      ...(body.maxSignatures !== undefined ? { maxSignatures: Number(body.maxSignatures) } : {}),
      ...(body.overrides && typeof body.overrides === "object" ? { overrides: body.overrides } : {}),
      ...(body.earlyStop && typeof body.earlyStop === "object" ? { earlyStop: body.earlyStop } : {}),
      ...(body.mode === "combined" || body.mode === "separate" ? { mode: body.mode } : {}),
      ...(body.collectMethod === "api" || body.collectMethod === "rpc" ? { collectMethod: body.collectMethod } : {}),
      ...(body.combined && typeof body.combined === "object" ? { combined: body.combined } : {}),
      ...(body.daysAtOnce !== undefined ? { daysAtOnce: body.daysAtOnce === null || body.daysAtOnce === "" ? 0 : Number(body.daysAtOnce) } : {}),
      ...(body.addressParallelism !== undefined ? { addressParallelism: body.addressParallelism === null || body.addressParallelism === "" ? null : Number(body.addressParallelism) } : {}),
    });
    // Backtests are worked one at a time: 0 = starts now, 1 = next after the one running, ...
    return NextResponse.json({ run: JSON.parse(JSON.stringify(run)), queuePosition: await getQueuePosition(run._id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create backtest" }, { status: 400 });
  }
}
