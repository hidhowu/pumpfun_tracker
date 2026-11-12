"use client";

import { useState } from "react";
import { CalendarX2, ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatUsd } from "@/lib/format";
import type { BacktestDaySummary } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { Panel } from "./parts";
import { formatSignedPercent, pnlTone } from "./shared";

function Fig({ label, value, tone, hint }: { label: string; value: React.ReactNode; tone?: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-text-3">{label}</span>
      <b className={cn("text-[18px] leading-6 font-semibold tabular-nums", tone)}>{value}</b>
      {hint && <span className="text-xs text-text-3">{hint}</span>}
    </div>
  );
}

/**
 * How steady the trader is, day by day: loss days, the profit margin (how much of the profit is left after the losing days)
 * and the same trader with its single best day removed - so one lucky day cannot carry a poor trader to the top of the list.
 * On phones it is folded to one line until opened.
 */
export function AddressQualityCard({ daily }: { daily: BacktestDaySummary | undefined }) {
  const [open, setOpen] = useState(false);
  if (!daily || daily.tradingDays === 0) return null;
  const without = daily.withoutBestDay;
  const margin = daily.profitMarginPercent;

  const body = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4 md:gap-5">
        <Fig label="Loss days" value={`${daily.lossDays} of ${daily.tradingDays}`} tone={daily.lossDays > 0 ? "text-negative" : undefined} hint="Days that closed in a loss" />
        <Fig
          label="Profit margin"
          value={margin != null ? `${margin.toFixed(0)}%` : "—"}
          tone={margin != null ? pnlTone(margin) : undefined}
          hint={margin != null ? `Profit days ${formatSignedPercent(daily.grossProfitPercent, 0)}, loss days ${formatSignedPercent(-daily.grossLossPercent, 0)}` : "No profitable day yet"}
        />
        <Fig label="Best day" value={daily.bestDay ? formatSignedPercent(daily.bestDay.percent, 0) : "—"} tone={daily.bestDay ? pnlTone(daily.bestDay.percent) : undefined} hint={daily.bestDay ? `${daily.bestDay.date} · ${formatUsd(daily.bestDay.pnlUsd)}` : undefined} />
        <Fig
          label="Without the best day"
          value={
            <>
              {without ? formatSignedPercent(without.combinedPercent, 0) : "—"}
              <HelpTip>Profit margin = (profit days − loss days) ÷ profit days, using each day&apos;s combined %: +100% and −20% give 80%, so losses took 20% of the profit.</HelpTip>
            </>
          }
          tone={without ? pnlTone(without.combinedPercent) : undefined}
          hint={without ? formatUsd(without.pnlUsd) : undefined}
        />
      </div>

      {without && (
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]",
            without.stillProfitable ? "border-positive/30 bg-pos-soft text-positive" : "border-destructive/30 bg-neg-soft text-[#ffc9d0]"
          )}
        >
          {without.stillProfitable ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <span>
            {without.stillProfitable
              ? `Still a profit trader if ${daily.bestDay?.date} had not happened: ${formatSignedPercent(without.combinedPercent, 0)} (${formatUsd(without.pnlUsd)})${
                  without.profitMarginPercent != null ? `, profit margin ${without.profitMarginPercent.toFixed(0)}%` : ""
                }.`
              : `Without ${daily.bestDay?.date} this trader would be a loss trader: ${formatSignedPercent(without.combinedPercent, 0)} (${formatUsd(without.pnlUsd)}). The profit rests on one day.`}
          </span>
        </div>
      )}
    </div>
  );

  const summary = `Loss days ${daily.lossDays} of ${daily.tradingDays}${margin != null ? ` · profit margin ${margin.toFixed(0)}%` : ""}${without?.stillProfitable ? " · still profit without best day" : ""}`;

  return (
    <>
      <div className="max-md:hidden">
        <Panel title="Consistency" icon={<CalendarX2 className="size-4 text-primary" />}>
          {body}
        </Panel>
      </div>
      <div className="overflow-hidden rounded-[16px] border border-border bg-card md:hidden">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[15px] font-semibold">Consistency</b>
            <span className="text-xs text-text-3">{summary}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} />
        </button>
        {open && <div className="border-t border-border px-4 py-4">{body}</div>}
      </div>
    </>
  );
}
