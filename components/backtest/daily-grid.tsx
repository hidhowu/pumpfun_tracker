"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpTip } from "@/components/ui/help-tip";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { WalletPerformanceChart, toChartPoints } from "@/components/wallets/wallet-performance-chart";
import { getBacktestAddressPnl, getBacktestDaily } from "@/lib/backtest-api";
import { formatAddress, formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { BacktestAddressPnl, BacktestDaily, BacktestDay } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { Kpi, Panel } from "./parts";
import { formatSignedPercent, pnlTone } from "./shared";

const EMPTY_DAY: BacktestDay = { pnlUsd: 0, combinedPercent: 0, trades: 0, wins: 0, losses: 0 };
const PAGE_SIZE = 50;

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

// The square's colours: two strengths of green or red by the day's combined %, quiet for days without trades (the same as the trader calendar).
function squareColors(d: BacktestDay, complete: boolean) {
  if (d.trades === 0) return { bg: "#141b16", fg: "#7e8f83", none: true };
  const c = d.combinedPercent;
  const bg = c > 0 ? (c > 15 ? "#1d6f55" : "#174d3d") : c < 0 ? (c < -8 ? "#7c2f3a" : "#4d2630") : "#141b16";
  return { bg, fg: complete ? "#eef4ef" : "#c8d3cb", none: false };
}

function percentText(value: number) {
  const abs = Math.abs(value);
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${abs >= 100 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(abs < 10 ? 1 : 0)}%`;
}

type Picked = { address: string; day: string; label: string; d: BacktestDay; complete: boolean };

function Square({ d, complete, index, onClick, selected }: { d: BacktestDay; complete: boolean; index: number; onClick?: () => void; selected?: boolean }) {
  const { bg, fg, none } = squareColors(d, complete);
  const text = d.trades === 0 ? (complete ? "—" : "…") : percentText(d.combinedPercent);
  const inner = (
    <>
      {index > 0 ? <span className="absolute top-1 left-1.5 text-[9.5px] leading-none opacity-70">{index}</span> : null}
      <b className={cn("font-semibold tabular-nums", text.length > 6 ? "text-[11px]" : text.length > 4 ? "text-[12.5px]" : "text-[14px]")}>{text}</b>
    </>
  );
  const cls = cn(
    "relative flex h-[50px] w-[60px] shrink-0 items-center justify-center rounded-[10px] border border-transparent transition-[filter,border-color]",
    !complete && !none && "opacity-75",
    onClick && "cursor-pointer hover:brightness-125 focus-visible:border-foreground focus-visible:outline-none",
    selected && "border-foreground"
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls} style={{ background: bg, color: fg }} aria-label={`${text}${d.trades > 0 ? `, ${d.trades} trades` : ""}`}>
      {inner}
    </button>
  ) : (
    <div className={cls} style={{ background: bg, color: fg }}>
      {inner}
    </div>
  );
}

/** One address-day: the figures and, when the address has trades that day, the hourly P&L. Used inside the popover (wide) and the sheet (phone). */
function DayDetails({ runId, picked, onClose, onOpenAddress }: { runId: string; picked: Picked; onClose?: () => void; onOpenAddress: () => void }) {
  const [hourly, setHourly] = useState<BacktestAddressPnl | null>(null);
  useEffect(() => {
    if (picked.d.trades === 0) return;
    let cancelled = false;
    getBacktestAddressPnl(runId, picked.address, "day", picked.day)
      .then((res) => !cancelled && setHourly(res))
      .catch(() => !cancelled && setHourly(null));
    return () => {
      cancelled = true;
    };
  }, [runId, picked.address, picked.day, picked.d.trades]);
  const { weekday, md } = dayHeader(picked.day);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <b className="truncate text-sm font-semibold">
            {picked.label || formatAddress(picked.address, 5)} · {weekday} {md}
          </b>
          <span className="text-xs text-text-3">{picked.complete ? "UTC day" : "still being simulated for this address"}</span>
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="P&L" value={picked.d.trades > 0 ? formatUsd(picked.d.pnlUsd) : "—"} className={pnlTone(picked.d.pnlUsd)} />
        <Kpi label="Combined" value={picked.d.trades > 0 ? formatSignedPercent(picked.d.combinedPercent, 0) : "—"} className={pnlTone(picked.d.combinedPercent)} />
        <Kpi label="W / L" value={`${picked.d.wins} / ${picked.d.losses}`} />
      </div>
      {picked.d.trades > 0 && hourly ? (
        <div className="flex flex-col gap-1">
          <WalletPerformanceChart points={toChartPoints(hourly)} mode="pnl" />
          <span className="text-xs text-text-3">Hourly P&amp;L (UTC)</span>
        </div>
      ) : null}
      <Button variant="outline" className="max-md:h-11" onClick={onOpenAddress}>
        Open address
      </Button>
    </div>
  );
}

/**
 * Every address's result for every UTC day of the backtest window, a page of addresses at a time (best P&L first). A day an
 * address hasn't been fully simulated through yet shows "…" (or dimmed numbers if some of its trades have already closed), so
 * partial results are never mistaken for a finished day. The "All addresses" row always adds up the whole backtest. Tap a square for the
 * day's figures.
 */
export function DailyGrid({ runId, refreshKey = 0 }: { runId: string; refreshKey?: number }) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const [data, setData] = useState<BacktestDaily | null>(null);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Picked | null>(null);

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
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const totalsFor = (day: string): BacktestDay => data.totalsByDay[day] ?? EMPTY_DAY;
  const sum = (days: BacktestDay[]): BacktestDay =>
    days.reduce((acc, d) => ({ pnlUsd: acc.pnlUsd + d.pnlUsd, combinedPercent: acc.combinedPercent + d.combinedPercent, trades: acc.trades + d.trades, wins: acc.wins + d.wins, losses: acc.losses + d.losses }), { ...EMPTY_DAY });
  const rowTotal = (address: string): BacktestDay => sum(data.days.map((day) => data.byAddress[address]?.[day] ?? EMPTY_DAY));
  const everyoneDone = data.allDone;
  const columns = `minmax(130px, 190px) repeat(${data.days.length}, 60px) 76px`;

  const open = (address: string) => window.open(`/backtest/${runId}/${address}`, "_blank", "noopener,noreferrer");

  return (
    <Panel
      title="Daily results"
      help="Each square is an address's day (combined %). Tap for $, trades and W/L. “…” = still being simulated for that address. Days are UTC, grouped by when the exit filled."
      aside={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-text-2">
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: "#1d6f55" }} />profit</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: "#7c2f3a" }} />loss</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm border border-line-2" style={{ background: "#141b16" }} />no trades</span>
        </span>
      }
      flush
    >
      <div className="overflow-x-auto p-3 md:p-4">
        <div className="grid w-max min-w-full items-center gap-x-1.5 gap-y-1.5" style={{ gridTemplateColumns: columns }}>
          <span className="sticky left-0 z-10 bg-card pr-2 text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Address</span>
          {data.days.map((day) => {
            const { weekday, md } = dayHeader(day);
            return (
              <span key={day} className="text-center text-[11px] leading-[14px] text-text-3">
                {weekday}
                <br />
                {md}
              </span>
            );
          })}
          <span className="text-center text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Total</span>

          {data.rows.map((t) => {
            const through = data.through[t.address];
            return (
              <div key={t.address} className="contents">
                <span className="sticky left-0 z-10 flex min-w-0 items-center gap-1 bg-card pr-2">
                  <span className="truncate font-mono text-xs" title={t.address}>
                    {t.label || formatAddress(t.address, 5)}
                  </span>
                  <CopyButton value={t.address} />
                </span>
                {data.days.map((day, i) => {
                  const d = data.byAddress[t.address]?.[day] ?? EMPTY_DAY;
                  const complete = isComplete(through, day);
                  const here = picked?.address === t.address && picked.day === day;
                  const square = <Square d={d} complete={complete} index={i + 1} selected={here} onClick={() => setPicked({ address: t.address, day, label: t.label, d, complete })} />;
                  return phone || !here ? (
                    <span key={day}>{square}</span>
                  ) : (
                    <Popover key={day} open onOpenChange={(next) => !next && setPicked(null)}>
                      <PopoverAnchor asChild>
                        <span>{square}</span>
                      </PopoverAnchor>
                      <PopoverContent className="w-80" align="center">
                        <DayDetails runId={runId} picked={picked} onClose={() => setPicked(null)} onOpenAddress={() => open(picked.address)} />
                      </PopoverContent>
                    </Popover>
                  );
                })}
                <Square d={rowTotal(t.address)} complete={through === null} index={0} />
              </div>
            );
          })}

          <span className="sticky left-0 z-10 bg-card pr-2 text-[13px] font-semibold">All addresses</span>
          {data.days.map((day) => (
            <span key={day}>
              <Square d={totalsFor(day)} complete={everyoneDone} index={0} />
            </span>
          ))}
          <Square d={sum(data.days.map(totalsFor))} complete={everyoneDone} index={0} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-text-3">
        <span>
          Addresses {((data.page - 1) * data.pageSize + 1).toLocaleString()}–{Math.min(data.total, data.page * data.pageSize).toLocaleString()} of {data.total.toLocaleString()}
          <HelpTip>… means that day is still being simulated for that address.</HelpTip>
        </span>
        {data.totalPages > 1 && (
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 max-md:h-10" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 max-md:h-10" disabled={data.page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </span>
        )}
      </div>

      {/* Phone: the day opens as a bottom sheet. */}
      <Dialog open={phone && !!picked} onOpenChange={(next) => !next && setPicked(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>Day details</DialogTitle>
            <DialogDescription>One address on one day.</DialogDescription>
          </DialogHeader>
          {picked ? <DayDetails runId={runId} picked={picked} onOpenAddress={() => open(picked.address)} /> : null}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
