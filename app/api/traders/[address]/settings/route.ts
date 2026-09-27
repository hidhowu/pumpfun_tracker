import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/db/connect";
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
  "benchCapPercent",
  "allowNegativeBalance",
  "executionDelaySeconds",
  "feeUsd",
];

type Params = { params: Promise<{ address: string }> };

/**
 * Per-trader simulation setting overrides. Body may include any subset of
 * the fields above; pass `null` to clear an override (fall back to global).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  await connectDb();
  const { address } = await params;
  const body = await request.json().catch(() => ({}));

  const existing = await Trader.findOne({ address });
  if (!existing) return NextResponse.json({ error: "Trader not found" }, { status: 404 });

  const patch: Record<string, number | boolean | null> = {};
  for (const field of FIELDS) {
    if (field in body) patch[field] = body[field];
  }

  const updated = await setTraderSimSettings(address, patch);
  const effectiveSettings = await resolveTraderSettings(updated!);
  return NextResponse.json({
    settings: updated!.settings,
    effectiveSettings,
  });
}
