"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBacktestDaily } from "@/lib/backtest-api";
import { formatAddress, formatUsd } from "@/lib/format";
import type { BacktestDaily, BacktestDay, BacktestRunTraderView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { formatSignedPercent, pnlTone } from "./shared";

const EMPTY_DAY: BacktestDay = { pnlUsd: 0, combinedPercent: 0, trades: 0, wins: 0, losses: 0 };

function dayHeader(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return { weekday, md: date.slice(5) };
}

/** Is `day` fully simulated for this address? (`through`: null = everything, "" = nothing yet, a date = days before it are complete.) */
function isComplete(through: string | null | undefined, day: string): boolean {
  if (through === null) return true;
  if (through === undefined || through === "") return false;
  return day < through;
}

function Cell({ d, complete }: { d: BacktestDay; complete: boolean }) {
  if (d.trades === 0) {
    return <span className="text-muted-foreground">{complete ? "—" : "…"}</span>;
  }
  return (
    <span className={cn("inline-flex flex-col items-end", !complete && "opacity-70")}>
      <span className={pnlTone(d.pnlUsd)}>{formatUsd(d.pnlUsd)}</span>
      <span className="text-[11px] text-muted-foreground">
        {formatSignedPercent(d.combinedPercent, 0)} · {d.wins}W/{d.losses}L
      </span>
    </span>
  );
}

/**
 * Every address's result for every UTC day of the backtest window. A day an
 * address hasn't been fully simulated through yet shows "…" (or dimmed
 * numbers if some of its trades have already closed), so partial results are
 * never mistaken for a finished day.
 */
export function DailyGrid({ runId, traders, refreshKey = 0 }: { runId: string; traders: BacktestRunTraderView[]; refreshKey?: number }) {
  const [data, setData] = useState<BacktestDaily | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBacktestDaily(runId)
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load daily results"));
    return () => {
      cancelled = true;
    };
  }, [runId, refreshKey]);

  if (!data) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const totalsFor = (day: string): BacktestDay =>
    traders.reduce(
      (acc, t) => {
        const d = data.byAddress[t.address]?.[day] ?? EMPTY_DAY;
        return { pnlUsd: acc.pnlUsd + d.pnlUsd, combinedPercent: acc.combinedPercent + d.combinedPercent, trades: acc.trades + d.trades, wins: acc.wins + d.wins, losses: acc.losses + d.losses };
      },
      { ...EMPTY_DAY }
    );
  const rowTotal = (address: string): BacktestDay =>
    data.days.reduce(
      (acc, day) => {
        const d = data.byAddress[address]?.[day] ?? EMPTY_DAY;
        return { pnlUsd: acc.pnlUsd + d.pnlUsd, combinedPercent: acc.combinedPercent + d.combinedPercent, trades: acc.trades + d.trades, wins: acc.wins + d.wins, losses: acc.losses + d.losses };
      },
      { ...EMPTY_DAY }
    );
  const everyoneDone = traders.every((t) => data.through[t.address] === null);

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-background">Address</TableHead>
            {data.days.map((day) => {
              const { weekday, md } = dayHeader(day);
              return (
                <TableHead key={day} className="text-right">
                  <span className="block">{weekday}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">{md}</span>
                </TableHead>
              );
            })}
            <TableHead className="pr-4 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {traders.map((t) => (
            <TableRow key={t.address} className="border-border/60">
              <TableCell className="sticky left-0 z-10 max-w-36 bg-background sm:max-w-48">
                <span className="block truncate font-mono text-xs" title={t.address}>
                  {t.label || formatAddress(t.address, 5)}
                </span>
              </TableCell>
              {data.days.map((day) => (
                <TableCell key={day} className="text-right tabular-nums">
                  <Cell d={data.byAddress[t.address]?.[day] ?? EMPTY_DAY} complete={isComplete(data.through[t.address], day)} />
                </TableCell>
              ))}
              <TableCell className="pr-4 text-right font-medium tabular-nums">
                <Cell d={rowTotal(t.address)} complete={data.through[t.address] === null} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="sticky left-0 z-10 bg-muted font-medium">All addresses</TableCell>
            {data.days.map((day) => (
              <TableCell key={day} className="text-right tabular-nums">
                <Cell d={totalsFor(day)} complete={traders.every((t) => isComplete(data.through[t.address], day))} />
              </TableCell>
            ))}
            <TableCell className="pr-4 text-right font-medium tabular-nums">
              <Cell d={data.days.reduce((acc, day) => {
                const d = totalsFor(day);
                return { pnlUsd: acc.pnlUsd + d.pnlUsd, combinedPercent: acc.combinedPercent + d.combinedPercent, trades: acc.trades + d.trades, wins: acc.wins + d.wins, losses: acc.losses + d.losses };
              }, { ...EMPTY_DAY })} complete={everyoneDone} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <div className="flex items-center gap-1 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <Tooltip>
          <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-2">…</TooltipTrigger>
          <TooltipContent>Not simulated that far yet</TooltipContent>
        </Tooltip>
        <span>= that day is still being simulated for that address. Days are UTC, grouped by when the exit filled.</span>
      </div>
    </div>
  );
}
