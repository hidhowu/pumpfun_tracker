"use client";

import { CalendarX2, ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsd } from "@/lib/format";
import type { BacktestDaySummary } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { formatSignedPercent, pnlTone } from "./shared";

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-base font-medium tabular-nums", tone)}>{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/**
 * How steady the trader is, day by day: loss days, the profit margin (how much of the profit is left after the losing days)
 * and the same trader with its single best day removed - so one lucky day cannot carry a poor trader to the top of the list.
 */
export function AddressQualityCard({ daily }: { daily: BacktestDaySummary | undefined }) {
  if (!daily || daily.tradingDays === 0) return null;
  const without = daily.withoutBestDay;
  const margin = daily.profitMarginPercent;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarX2 className="size-4 text-primary" /> Consistency
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Loss days" value={`${daily.lossDays} of ${daily.tradingDays}`} tone={daily.lossDays > 0 ? "text-negative" : undefined} hint="Days that closed in a loss" />
          <Stat
            label="Profit margin"
            value={margin != null ? `${margin.toFixed(0)}%` : "—"}
            tone={margin != null ? pnlTone(margin) : undefined}
            hint={margin != null ? `Profit days ${formatSignedPercent(daily.grossProfitPercent, 0)}, loss days ${formatSignedPercent(-daily.grossLossPercent, 0)}` : "No profitable day yet"}
          />
          <Stat
            label="Best day"
            value={daily.bestDay ? formatSignedPercent(daily.bestDay.percent, 0) : "—"}
            tone={daily.bestDay ? pnlTone(daily.bestDay.percent) : undefined}
            hint={daily.bestDay ? `${daily.bestDay.date} · ${formatUsd(daily.bestDay.pnlUsd)}` : undefined}
          />
          <Stat
            label="Without the best day"
            value={without ? formatSignedPercent(without.combinedPercent, 0) : "—"}
            tone={without ? pnlTone(without.combinedPercent) : undefined}
            hint={without ? formatUsd(without.pnlUsd) : undefined}
          />
        </div>

        {without && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
              without.stillProfitable ? "border-positive/30 bg-positive/10 text-positive" : "border-negative/30 bg-negative/10 text-negative"
            )}
          >
            {without.stillProfitable ? <ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> : <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />}
            <span>
              {without.stillProfitable
                ? `Still a profit trader if ${daily.bestDay?.date} had not happened: ${formatSignedPercent(without.combinedPercent, 0)} (${formatUsd(without.pnlUsd)})${
                    without.profitMarginPercent != null ? `, profit margin ${without.profitMarginPercent.toFixed(0)}%` : ""
                  }.`
                : `Without ${daily.bestDay?.date} this trader would be a loss trader: ${formatSignedPercent(without.combinedPercent, 0)} (${formatUsd(without.pnlUsd)}). The profit rests on one day.`}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Profit margin = (profit days − loss days) ÷ profit days, using each day&apos;s combined %: +100% and −20% give 80%, so losses took 20% of the profit. A margin near 0 means the
          losing days ate almost all of it.
        </p>
      </CardContent>
    </Card>
  );
}
