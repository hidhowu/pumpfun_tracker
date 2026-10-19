import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Trader } from "@/db/models/Trader";
import { setTraderSimSettings } from "@/db/traderService";
import { resolveTraderSettings } from "@/db/settings";
import { isObjectIdString, validateSettingsPatch, validateTrailingStops } from "@/db/settingsLimits";

const FIELDS = [
  "allocationUsd",
  "tradeSizeUsd",
  "dustBuyUsd",
  "dustSellFractionPercent",
  "stopLossPercent",
  "takeProfitPercent",
  "maxTradeTimeSeconds",
  "executionDelaySeconds",
  "pumpFeePercent",
  "jitoFeeUsd",
];
const BOOLEAN_FIELDS = ["allowNegativeBalance"];

type Params = { params: Promise<{ address: string }> };

/**
 * Per-trader simulation setting overrides. Body may include any subset of
 * the fields above; pass `null` to clear an override (fall back to global).
 * `trailingStops` is separate: pass an array (whole-list override, [] means
 * "no trailing stops for this trader") or `null` to inherit the global list.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireApiSession();
  if (denied) return denied;
  await connectDb();
  const { address } = await params;
  const profileId = request.nextUrl.searchParams.get("profileId");
  if (!profileId || !isObjectIdString(profileId)) return NextResponse.json({ error: "A valid profileId is required" }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const existing = await Trader.findOne({ address });
  if (!existing) return NextResponse.json({ error: "Trader not found" }, { status: 404 });

  // Every number is range-checked (db/settingsLimits.js); null clears an override.
  const checked = validateSettingsPatch(body, FIELDS, { nullable: FIELDS });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...checked.values };
  for (const field of BOOLEAN_FIELDS) {
    if (field in body) {
      if (body[field] !== null && typeof body[field] !== "boolean") return NextResponse.json({ error: `${field} must be true, false or null` }, { status: 400 });
      patch[field] = body[field];
    }
  }
  if ("trailingStops" in body) {
    if (body.trailingStops === null) {
      patch.trailingStops = null;
    } else {
      const rules = validateTrailingStops(body.trailingStops);
      if (!rules.ok) return NextResponse.json({ error: rules.error }, { status: 400 });
      patch.trailingStops = rules.value;
    }
  }

  const updated = await setTraderSimSettings(profileId, address, patch);
  const effectiveSettings = await resolveTraderSettings(profileId, address, { profileTrader: updated! });
  return NextResponse.json({
    settings: updated!.settings,
    effectiveSettings,
  });
}
