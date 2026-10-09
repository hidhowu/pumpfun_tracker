import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
import { requireApiSession } from "@/lib/auth/session";
import { Trader } from "@/db/models/Trader";
import { setTraderSimSettings } from "@/db/traderService";
import { resolveTraderSettings } from "@/db/settings";

const FIELDS = [
  "allocationUsd",
  "tradeSizeUsd",
  "dustBuyUsd",
  "dustSellFractionPercent",
  "stopLossPercent",
  "takeProfitPercent",
  "maxTradeTimeSeconds",
  "allowNegativeBalance",
  "executionDelaySeconds",
  "pumpFeePercent",
  "jitoFeeUsd",
];

type Params = { params: Promise<{ address: string }> };

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
  if (!profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  const body = await request.json().catch(() => ({}));

  const existing = await Trader.findOne({ address });
  if (!existing) return NextResponse.json({ error: "Trader not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  for (const field of FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    // Fees can't be negative; null (clear the override) passes through.
    patch[field] = (field === "pumpFeePercent" || field === "jitoFeeUsd") && typeof value === "number" ? Math.max(0, value) : value;
  }
  if ("trailingStops" in body) {
    if (body.trailingStops === null || isValidTrailingStops(body.trailingStops)) {
      patch.trailingStops = body.trailingStops;
    }
  }

  const updated = await setTraderSimSettings(profileId, address, patch);
  const effectiveSettings = await resolveTraderSettings(profileId, address, { profileTrader: updated! });
  return NextResponse.json({
    settings: updated!.settings,
    effectiveSettings,
  });
}
