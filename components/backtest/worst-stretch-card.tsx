"use client";

import { CalendarRange } from "lucide-react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd } from "@/lib/format";
import type { BacktestWorstStretch } from "@/lib/backtest-types";
import { Mini, Note, Panel } from "./parts";
import { formatDate, formatSignedPercent, pnlTone } from "./shared";
import { cn } from "@/lib/utils";

/**
 * The worst days in a row: every 7 days in a row of the backtest is added up (days 1-7, then 2-8, then 3-9 ...) and the stretch with the lowest
 * total is shown, day by day.
 */
export function WorstStretchCard({ stretch }: { stretch: BacktestWorstStretch }) {
  const { worst, length, windows, belowZero, dayCount, startingUsd } = stretch;

  return (
    <Panel
      title={`Worst ${length} days`}
      icon={<CalendarRange className="size-4 text-negative" />}
      help={`Every ${length} days in a row are added up (days 1-${length}, then 2-${length + 1}, then 3-${length + 2} ...) and the stretch with the lowest total is the worst one. A day with no trade counts as 0. Uses each day's result as the daily breakdown shows it.`}
      aside={`every ${length} days in a row, added up`}
    >
      {!worst ? (
        <Note className="text-sm text-text-2">
          {dayCount === 0 ? "No days yet." : `This backtest covers ${dayCount} day${dayCount === 1 ? "" : "s"}, which is fewer than ${length}, so there is no ${length}-day stretch to compare.`}
        </Note>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Mini
              label={`Worst ${length} days in a row`}
              value={formatUsd(worst.pnlUsd)}
              tone={worst.pnlUsd < 0 ? "neg" : "pos"}
              hint={
                <>
                  {startingUsd > 0 && <>{formatSignedPercent(worst.percent, 1)} of the {formatUsd(startingUsd)} start · </>}
                  {formatDate(worst.startDate)} – {formatDate(worst.endDate)} · {worst.trades.toLocaleString()} trade{worst.trades === 1 ? "" : "s"}
                  {worst.pnlUsd >= 0 && " · never lost over any stretch"}
                </>
              }
            />
            <Mini
              label={`${length}-day stretches that lost`}
              value={
                <>
                  {belowZero.toLocaleString()} <span className="text-base font-medium text-text-3">/ {windows.toLocaleString()}</span>
                </>
              }
              hint={`of all the ${length}-day stretches in these ${dayCount} days`}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border max-md:hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Day (UTC)</TableHead>
                  <TableHead className="text-right text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Closed trades</TableHead>
                  <TableHead className="text-right text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">P&amp;L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {worst.days.map((d) => (
                  <TableRow key={d.date} className="border-border">
                    <TableCell className="text-[13px]">{formatDate(d.date)}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{d.trades.toLocaleString()}</TableCell>
                    <TableCell className={cn("text-right text-[13px] tabular-nums", pnlTone(d.pnlUsd))}>{formatUsd(d.pnlUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="bg-transparent">
                <TableRow className="border-line-2 hover:bg-transparent">
                  <TableCell className="text-[13px] font-semibold">Total of the {length} days</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{worst.trades.toLocaleString()}</TableCell>
                  <TableCell className={cn("text-right text-[13px] font-semibold tabular-nums", pnlTone(worst.pnlUsd))}>{formatUsd(worst.pnlUsd)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </>
      )}
    </Panel>
  );
}
