import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getGlobalSettings, GlobalSettings } from "@/db/models/GlobalSettings";

export async function GET() {
  await connectDb();
  const settings = await getGlobalSettings();
  return NextResponse.json({ settings: JSON.parse(JSON.stringify(settings)) });
}

const NUMERIC_FIELDS = [
  "defaultAllocationUsd",
  "defaultTradeSizeUsd",
  "defaultDustBuyUsd",
  "defaultDustSellFractionPercent",
  "defaultExecutionDelaySeconds",
  "defaultFeeUsd",
  "riskCheckIntervalSeconds",
];
const NULLABLE_NUMERIC_FIELDS = ["defaultStopLossPercent", "defaultTakeProfitPercent", "defaultBenchCapPercent"]; // null = disabled
const BOOLEAN_FIELDS = ["defaultMuted", "defaultAllowNegativeBalance"];

/**
 * Body may include any subset of the global simulation defaults:
 * defaultMuted, defaultAllocationUsd, defaultTradeSizeUsd, defaultDustBuyUsd,
 * defaultDustSellFractionPercent, defaultStopLossPercent (number or null),
 * defaultTakeProfitPercent (number or null), defaultBenchCapPercent (number or null),
 * defaultAllowNegativeBalance, defaultExecutionDelaySeconds, defaultFeeUsd.
 */
export async function PATCH(request: NextRequest) {
  await connectDb();
  const body = await request.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") update[field] = body[field];
  }
  for (const field of NUMERIC_FIELDS) {
    if (typeof body[field] === "number" && Number.isFinite(body[field])) update[field] = body[field];
  }
  // A too-low risk-check interval would hammer the price API and the DB in a tight loop - floor it.
  if (typeof update.riskCheckIntervalSeconds === "number") {
    update.riskCheckIntervalSeconds = Math.max(5, update.riskCheckIntervalSeconds);
  }
  for (const field of NULLABLE_NUMERIC_FIELDS) {
    if (body[field] === null) update[field] = null;
    else if (typeof body[field] === "number" && Number.isFinite(body[field])) update[field] = body[field];
  }

  const settings = await GlobalSettings.findOneAndUpdate({ key: "global" }, update, { returnDocument: "after", upsert: true });
  return NextResponse.json({ settings: JSON.parse(JSON.stringify(settings)) });
}
