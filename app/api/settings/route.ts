import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { getGlobalSettings, GlobalSettings } from "@/db/models/GlobalSettings";
import { getSystemSettings, SystemSettings } from "@/db/models/SystemSettings";
import { isObjectIdString, validateSettingsPatch, validateTrailingStops } from "@/db/settingsLimits";

/** GET/PATCH here present one flat settings object to the UI, backed by two collections: GlobalSettings (per-profile strategy defaults) and SystemSettings (defaultMuted/riskCheckIntervalSeconds - shared across every profile). */
export async function GET(request: NextRequest) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId || !isObjectIdString(profileId)) return NextResponse.json({ error: "A valid profileId is required" }, { status: 400 });

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
const SYSTEM_BOOLEAN_FIELDS = ["defaultMuted", "tradingPaused"]; // tradingPaused = kill switch for new buys

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
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId || !isObjectIdString(profileId)) return NextResponse.json({ error: "A valid profileId is required" }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  // Every number is range-checked (db/settingsLimits.js) and rejected - not clamped - when out of range.
  const checked = validateSettingsPatch(body, [...NUMERIC_FIELDS, ...NULLABLE_NUMERIC_FIELDS, ...SYSTEM_NUMERIC_FIELDS], {
    nullable: NULLABLE_NUMERIC_FIELDS,
  });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const profileUpdate: Record<string, unknown> = {};
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") profileUpdate[field] = body[field];
  }
  for (const field of [...NUMERIC_FIELDS, ...NULLABLE_NUMERIC_FIELDS]) {
    if (field in checked.values) profileUpdate[field] = checked.values[field];
  }
  if ("defaultTrailingStops" in body) {
    const rules = validateTrailingStops(body.defaultTrailingStops);
    if (!rules.ok) return NextResponse.json({ error: rules.error }, { status: 400 });
    profileUpdate.defaultTrailingStops = rules.value;
  }

  const systemUpdate: Record<string, unknown> = {};
  for (const field of SYSTEM_BOOLEAN_FIELDS) {
    if (typeof body[field] === "boolean") systemUpdate[field] = body[field];
  }
  if (typeof systemUpdate.tradingPaused === "boolean") systemUpdate.tradingPausedAt = systemUpdate.tradingPaused ? new Date() : null;
  for (const field of SYSTEM_NUMERIC_FIELDS) {
    if (field in checked.values) systemUpdate[field] = checked.values[field];
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
