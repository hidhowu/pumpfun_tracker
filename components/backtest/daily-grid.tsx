"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBacktestDaily } from "@/lib/backtest-api";
import { formatAddress, formatUsd } from "@/lib/format";
import type { BacktestDaily, BacktestDay } from "@/lib/backtest-types";
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

const PAGE_SIZE = 50;

/**
 * Every address's result for every UTC day of the backtest window, a page of addresses at a time (best P&L first). A day an
 * address hasn't been fully simulated through yet shows "…" (or dimmed numbers if some of its trades have already closed), so
 * partial results are never mistaken for a finished day. The "All addresses" row always adds up the whole backtest.
 */
export function DailyGrid({ runId, refreshKey = 0 }: { runId: string; refreshKey?: number }) {
  const [data, setData] = useState<BacktestDaily | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    getBacktestDaily(runId, page, PAGE_SIZE)
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load daily results"));
    return () => {
      cancelled = true;
    };
  }, [runId, refreshKey, page]);

  if (!data) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const totalsFor = (day: string): BacktestDay => data.totalsByDay[day] ?? EMPTY_DAY;
  const rowTotal = (address: string): BacktestDay =>
    data.days.reduce(
      (acc, day) => {
        const d = data.byAddress[address]?.[day] ?? EMPTY_DAY;
        return { pnlUsd: acc.pnlUsd + d.pnlUsd, combinedPercent: acc.combinedPercent + d.combinedPercent, trades: acc.trades + d.trades, wins: acc.wins + d.wins, losses: acc.losses + d.losses };
      },
      { ...EMPTY_DAY }
    );
  const everyoneDone = data.allDone;

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
          {data.rows.map((t) => (
            <TableRow key={t.address} className="border-border/60">
              <TableCell className="sticky left-0 z-10 max-w-36 bg-background sm:max-w-48">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate font-mono text-xs" title={t.address}>
                    {t.label || formatAddress(t.address, 5)}
                  </span>
                  <CopyButton value={t.address} />
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
                <Cell d={totalsFor(day)} complete={everyoneDone} />
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
        {data.totalPages > 1 && (
          <span className="ml-auto flex items-center gap-1.5">
            <span>
              Addresses {((data.page - 1) * data.pageSize + 1).toLocaleString()}–{Math.min(data.total, data.page * data.pageSize).toLocaleString()} of {data.total.toLocaleString()}
            </span>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" disabled={data.page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}
