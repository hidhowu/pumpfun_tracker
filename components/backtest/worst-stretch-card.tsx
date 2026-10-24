"use client";

import { CalendarRange } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd } from "@/lib/format";
import type { BacktestWorstStretch } from "@/lib/backtest-types";
import { formatDate, formatSignedPercent, pnlTone } from "./shared";
import { cn } from "@/lib/utils";

/**
 * The worst days in a row: every 7 days in a row of the backtest is added up (days 1-7, then 2-8, then 3-9 ...) and the stretch with the lowest
 * total is shown, day by day.
 */
export function WorstStretchCard({ stretch }: { stretch: BacktestWorstStretch }) {
  const { worst, length, windows, belowZero, dayCount, startingUsd } = stretch;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="size-4 text-negative" /> Worst {length} days
        </CardTitle>
        <CardDescription>
          Every {length} days in a row are added up (days 1-{length}, then 2-{length + 1}, then 3-{length + 2} ...) and the stretch with the lowest total is the
          worst one. A day with no trade counts as 0. Uses each day&apos;s result as the daily breakdown shows it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!worst ? (
          <p className="text-sm text-muted-foreground">
            {dayCount === 0 ? "No days yet." : `This backtest covers ${dayCount} day${dayCount === 1 ? "" : "s"}, which is fewer than ${length}, so there is no ${length}-day stretch to compare.`}
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
                <span className="text-[13px] font-semibold text-muted-foreground">Worst {length} days in a row</span>
                <span className={cn("text-2xl font-extrabold tracking-tight tabular-nums", worst.pnlUsd < 0 ? "text-negative" : "text-positive")}>{formatUsd(worst.pnlUsd)}</span>
                <span className="text-xs text-muted-foreground">
                  {startingUsd > 0 && <>{formatSignedPercent(worst.percent, 1)} of the {formatUsd(startingUsd)} start · </>}
                  {formatDate(worst.startDate)} to {formatDate(worst.endDate)} UTC · {worst.trades.toLocaleString()} closed trade{worst.trades === 1 ? "" : "s"}
                  {worst.pnlUsd >= 0 && " · never lost over any stretch"}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
                <span className="text-[13px] font-semibold text-muted-foreground">{length}-day stretches that lost</span>
                <span className="text-2xl font-extrabold tracking-tight tabular-nums">
                  {belowZero.toLocaleString()} <span className="text-base font-semibold text-muted-foreground">/ {windows.toLocaleString()}</span>
                </span>
                <span className="text-xs text-muted-foreground">of all the {length}-day stretches in these {dayCount} days</span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead>Day (UTC)</TableHead>
                    <TableHead className="text-right">Closed trades</TableHead>
                    <TableHead className="text-right">Profit and loss</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {worst.days.map((d) => (
                    <TableRow key={d.date} className="border-border/60">
                      <TableCell>{formatDate(d.date)}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.trades.toLocaleString()}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", pnlTone(d.pnlUsd))}>{formatUsd(d.pnlUsd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="border-border/60">
                    <TableCell className="font-semibold">Total of the {length} days</TableCell>
                    <TableCell className="text-right tabular-nums">{worst.trades.toLocaleString()}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", pnlTone(worst.pnlUsd))}>{formatUsd(worst.pnlUsd)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
