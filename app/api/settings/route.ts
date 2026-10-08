import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { getGlobalSettings, GlobalSettings } from "@/db/models/GlobalSettings";
import { getSystemSettings, SystemSettings } from "@/db/models/SystemSettings";

/** GET/PATCH here present one flat settings object to the UI, backed by two collections: GlobalSettings (per-profile strategy defaults) and SystemSettings (defaultMuted/riskCheckIntervalSeconds - shared across every profile). */
export async function GET(request: NextRequest) {
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });

  const [profileSettings, systemSettings] = await Promise.all([getGlobalSettings(profileId), getSystemSettings()]);
  const merged = { ...JSON.parse(JSON.stringify(profileSettings)), ...JSON.parse(JSON.stringify(systemSettings)) };
  return NextResponse.json({ settings: merged });
}

const NUMERIC_FIELDS = [
  "defaultAllocationUsd",
  "defaultTradeSizeUsd",
  "defaultDustBuyUsd",
  "defaultDustSellFractionPercent",
  "defaultExecutionDelaySeconds",
  "defaultPumpFeePercent",
  "defaultJitoFeeUsd",
  "defaultMaxTradeTimeSeconds", // 0 = disabled/infinite, not nullable
];
const NULLABLE_NUMERIC_FIELDS = ["defaultStopLossPercent", "defaultTakeProfitPercent"]; // null = disabled
const BOOLEAN_FIELDS = ["defaultAllowNegativeBalance"];

// These two are system-wide, not per-profile - see db/models/SystemSettings.js.
const SYSTEM_NUMERIC_FIELDS = ["riskCheckIntervalSeconds"];
const SYSTEM_BOOLEAN_FIELDS = ["defaultMuted"];

function isValidTrailingStops(value: unknown): value is { armPercent: number; exitPercent: number }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof (r as { armPercent?: unknown }).armPercent === "number" &&
        typeof (r as { exitPercent?: unknown }).exitPercent === "number"
    )
  );
}

/**
 * Body may include any subset of: this profile's simulation defaults
 * (defaultAllocationUsd, defaultTradeSizeUsd, defaultDustBuyUsd,
 * defaultDustSellFractionPercent, defaultStopLossPercent (number or null),
 * defaultTakeProfitPercent (number or null), defaultMaxTradeTimeSeconds
 * (number, 0 = disabled), defaultTrailingStops (array of {armPercent,
 * exitPercent} - whole-list replacement), defaultAllowNegativeBalance,
 * defaultExecutionDelaySeconds, defaultPumpFeePercent, defaultJitoFeeUsd) plus the two system-wide
 * fields (defaultMuted, riskCheckIntervalSeconds), which apply regardless
 * of which profile is selected.
 */
export async function PATCH(request: NextRequest) {
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const body = await request.json().catch(() => ({}));

  const profileUpdate: Record<string, unknown> = {};
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") profileUpdate[field] = body[field];
  }
  for (const field of NUMERIC_FIELDS) {
    if (typeof body[field] === "number" && Number.isFinite(body[field])) profileUpdate[field] = body[field];
  }
  // None of these can meaningfully be negative.
  for (const field of ["defaultMaxTradeTimeSeconds", "defaultPumpFeePercent", "defaultJitoFeeUsd"]) {
    if (typeof profileUpdate[field] === "number") profileUpdate[field] = Math.max(0, profileUpdate[field] as number);
  }
  for (const field of NULLABLE_NUMERIC_FIELDS) {
    if (body[field] === null) profileUpdate[field] = null;
    else if (typeof body[field] === "number" && Number.isFinite(body[field])) profileUpdate[field] = body[field];
  }
  if (isValidTrailingStops(body.defaultTrailingStops)) {
    profileUpdate.defaultTrailingStops = body.defaultTrailingStops;
  }

  const systemUpdate: Record<string, unknown> = {};
  for (const field of SYSTEM_BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") systemUpdate[field] = body[field];
  }
  for (const field of SYSTEM_NUMERIC_FIELDS) {
    if (typeof body[field] === "number" && Number.isFinite(body[field])) systemUpdate[field] = body[field];
  }
  // A too-low risk-check interval would hammer the price API and the DB in a tight loop - floor it.
  if (typeof systemUpdate.riskCheckIntervalSeconds === "number") {
    systemUpdate.riskCheckIntervalSeconds = Math.max(5, systemUpdate.riskCheckIntervalSeconds);
  }

  const [profileSettings, systemSettings] = await Promise.all([
    GlobalSettings.findOneAndUpdate({ profileId }, profileUpdate, { returnDocument: "after", upsert: true }),
    Object.keys(systemUpdate).length
      ? SystemSettings.findOneAndUpdate({ key: "system" }, systemUpdate, { returnDocument: "after", upsert: true })
      : getSystemSettings(),
  ]);

  const merged = { ...JSON.parse(JSON.stringify(profileSettings)), ...JSON.parse(JSON.stringify(systemSettings)) };
  return NextResponse.json({ settings: merged });
}
