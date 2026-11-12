"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Info, LineChart, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DailyBar } from "@/components/traders/pnl-breakdown";
import { WalletPerformanceChart, toChartPoints, type ChartMode } from "@/components/wallets/wallet-performance-chart";
import { getBacktestAddressPnl } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { BacktestAddressPnl, BacktestPnlPeriod } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { Kpi, Panel } from "./parts";
import { formatSignedPercent, pnlTone } from "./shared";

function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MODE_COPY: Record<ChartMode, Record<BacktestPnlPeriod, { title: string; description: string }>> = {
  value: {
    day: { title: "Wallet value by hour", description: "Balance + open-trade value, hour by hour (UTC)." },
    week: { title: "Wallet value over time", description: "Balance + open-trade value at the end of each day." },
    month: { title: "Wallet value over time", description: "Balance + open-trade value at the end of each day." },
    all: { title: "Wallet value over the whole backtest", description: "Balance + open-trade value at the end of each day." },
  },
  pnl: {
    day: { title: "Realized P&L by hour", description: "P&L of trades that closed in each hour (UTC)." },
    week: { title: "Daily realized P&L", description: "P&L of trades that closed on each day (UTC)." },
    month: { title: "Daily realized P&L", description: "P&L of trades that closed on each day (UTC)." },
    all: { title: "Daily realized P&L over the whole backtest", description: "P&L of trades that closed on each day (UTC)." },
  },
};

const MODES = [
  { value: "value", label: "Value" },
  { value: "pnl", label: "P&L" },
] as const;
const PERIODS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
] as const;

const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
      <span className="text-xs text-text-3">{label}</span>
      <b className={cn("text-lg leading-6 font-semibold tabular-nums", tone)}>{value}</b>
      {hint ? <span className="text-xs leading-[17px] text-text-3">{hint}</span> : null}
    </div>
  );
}

/** The address's results over time - the live trader's P&L tab (headline numbers, streaks, daily bars) plus the wallet value / P&L charts of a live wallet. */
export function AddressPnlPanel({ runId, address, refreshKey }: { runId: string; address: string; refreshKey: number }) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const [period, setPeriod] = useState<BacktestPnlPeriod>("all");
  const [mode, setMode] = useState<ChartMode>("value");
  const [dayDate, setDayDate] = useState<string | null>(null); // null = the window's last day
  const [pnl, setPnl] = useState<BacktestAddressPnl | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBacktestAddressPnl(runId, address, period, period === "day" ? (dayDate ?? undefined) : undefined)
      .then((res) => !cancelled && setPnl(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load P&L"));
    return () => {
      cancelled = true;
    };
  }, [runId, address, period, dayDate, refreshKey]);

  const copy = MODE_COPY[mode][period];
  const shownDay = pnl?.date ?? dayDate;
  const atLastDay = !!pnl && pnl.date >= pnl.range.to;
  const atFirstDay = !!pnl && pnl.date <= pnl.range.from;
  const stillRunning = pnl != null && pnl.through !== null;
  const negativeDays = pnl?.negativeBalanceBreakdown.some((d) => d.count > 0) ?? false;
  const daysWithTrades = pnl ? pnl.dailyBreakdown.filter((d) => d.closedTradeCount > 0).length : 0;
  const streak = pnl?.streaks.currentStreak;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {stillRunning && pnl && (
        <div className="flex items-start gap-2.5 rounded-xl border border-volt-line bg-volt-soft px-3.5 py-2.5 text-[13px] text-text-2">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            {pnl.through ? `Days before ${pnl.through} are complete - ` : "Nothing is complete yet - "}
            the rest are still filling in, so their numbers can still change.
          </span>
        </div>
      )}

      <section className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 md:px-5">
          <b className="flex items-center gap-2 text-[15px] font-semibold">
            <LineChart className="size-4 text-primary" />
            {copy.title}
            <HelpTip className="ml-0">{copy.description}</HelpTip>
          </b>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            <Segmented options={MODES} value={mode} onChange={setMode} label="Chart shows" block={phone} tall={phone} />
            <Segmented
              options={PERIODS}
              value={period}
              onChange={(v) => {
                setPeriod(v);
                setPnl(null);
              }}
              label="Period"
              block={phone}
              tall={phone}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 p-4 md:p-5">
          {period === "day" && shownDay && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size={phone ? "icon-lg" : "icon-sm"} aria-label="Previous day" disabled={atFirstDay} onClick={() => setDayDate(addDaysUtc(shownDay, -1))}>
                <ChevronLeft />
              </Button>
              <span className="min-w-[150px] text-center text-sm font-medium tabular-nums">{shownDay}</span>
              <Button variant="outline" size={phone ? "icon-lg" : "icon-sm"} aria-label="Next day" disabled={atLastDay} onClick={() => setDayDate(addDaysUtc(shownDay, 1))}>
                <ChevronRight />
              </Button>
            </div>
          )}

          {pnl === null ? <Skeleton className="h-56 w-full rounded-xl" /> : <WalletPerformanceChart points={toChartPoints(pnl)} mode={mode} />}

          {pnl && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-5">
              <Kpi label="Period P&L" value={pnl.actualizedUsd != null ? signedUsd(pnl.actualizedUsd) : "—"} className={pnlTone(pnl.actualizedUsd)} />
              <Kpi label="Realized P&L" value={signedUsd(pnl.combinedUsd)} className={pnlTone(pnl.combinedUsd)} />
              <Kpi label="Closed trades" value={pnl.closedTradeCount} />
              <Kpi label="Win rate" value={pnl.winRatePercent != null ? `${pnl.winRatePercent.toFixed(0)}%` : "—"} />
              <Kpi
                label="Current streak"
                value={streak && streak.type !== "none" ? `${streak.length}d ${streak.type}` : "—"}
                className={streak?.type === "profit" ? "text-positive" : streak?.type === "loss" ? "text-negative" : undefined}
              />
            </div>
          )}
        </div>
      </section>

      <Panel
        title="Day by day"
        icon={<CalendarDays className="size-4 text-primary" />}
        help="Which days made money and which lost it, over the same period as the chart above."
      >
        {pnl === null ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Figure
                label="Actualized"
                value={pnl.actualizedUsd !== null ? signedUsd(pnl.actualizedUsd) : "—"}
                hint="Start vs end, incl. open trades"
                tone={pnlTone(pnl.actualizedUsd)}
              />
              <Figure label="Combined" value={formatSignedPercent(pnl.combinedPercent)} hint="Sum of each trade's % return" tone={pnlTone(pnl.combinedPercent)} />
              <Figure label="Closed trades" value={String(pnl.closedTradeCount)} hint={`${pnl.averageTradesPerDay.toFixed(1)} / day avg`} />
              <Figure
                label="Current streak"
                value={streak && streak.type !== "none" ? `${streak.length}d` : "—"}
                hint={streak && streak.type !== "none" ? `${streak.length}-day ${streak.type} streak` : "No active streak"}
                tone={streak?.type === "profit" ? "text-positive" : streak?.type === "loss" ? "text-negative" : undefined}
              />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] text-text-2 md:grid-cols-4">
              <span>
                Profitable days: <b className="font-semibold text-foreground">{pnl.streaks.profitableDays}</b>
              </span>
              <span>
                Loss days: <b className="font-semibold text-foreground">{pnl.streaks.lossDays}</b>
              </span>
              <span>
                Longest win streak: <b className="font-semibold text-foreground">{pnl.streaks.longestProfitStreak}d</b>
              </span>
              <span>
                Longest loss streak: <b className="font-semibold text-foreground">{pnl.streaks.longestLossStreak}d</b>
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-3">Daily combined P&amp;L</span>
                {negativeDays && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-negative">
                    <TriangleAlert className="size-3" /> went negative
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {pnl.dailyBreakdown.map((day) => (
                  <DailyBar key={day.date} day={day} negativeBalance={pnl.negativeBalanceBreakdown.find((n) => n.date === day.date)} />
                ))}
              </div>
            </div>

            {daysWithTrades > 0 && (
              <>
                {/* Phone: one line per day. */}
                <div className="flex flex-col md:hidden">
                  {[...pnl.dailyBreakdown].reverse().map((d) => (
                    <div key={d.date} className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-[13px] last:border-0">
                      <span className="flex flex-col leading-[1.3]">
                        <b className="font-semibold tabular-nums">{d.date}</b>
                        <span className="text-xs text-text-3">{d.closedTradeCount > 0 ? `${d.closedTradeCount} ${d.closedTradeCount === 1 ? "trade" : "trades"} · ${d.wins}W / ${d.losses}L` : "no trades"}</span>
                      </span>
                      <span className="flex flex-col items-end leading-[1.3] tabular-nums">
                        <b className={cn("font-semibold", d.closedTradeCount > 0 ? pnlTone(d.combinedUsd) : "text-text-3")}>{d.closedTradeCount > 0 ? signedUsd(d.combinedUsd) : "—"}</b>
                        <span className={cn("text-xs", d.closedTradeCount > 0 ? pnlTone(d.combinedPercent) : "text-text-3")}>
                          {d.closedTradeCount > 0 ? formatSignedPercent(d.combinedPercent) : d.valueUsd != null ? formatUsd(d.valueUsd) : "—"}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>

                {/* Wide screens: the table. */}
                <div className="-mx-5 -mb-5 overflow-x-auto border-t border-border max-md:hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className={cn(headCls, "pl-5")}>Day</TableHead>
                        <TableHead className={cn(headCls, "text-right")}>Trades</TableHead>
                        <TableHead className={cn(headCls, "text-right")}>W / L</TableHead>
                        <TableHead className={cn(headCls, "text-right")}>P&amp;L</TableHead>
                        <TableHead className={cn(headCls, "text-right")}>Combined</TableHead>
                        <TableHead className={cn(headCls, "pr-5 text-right")}>Wallet value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...pnl.dailyBreakdown].reverse().map((d) => (
                        <TableRow key={d.date} className="h-[48px] border-border">
                          <TableCell className="pl-5 text-[13px] whitespace-nowrap">{d.date}</TableCell>
                          <TableCell className="text-right text-[13px] tabular-nums">{d.closedTradeCount}</TableCell>
                          <TableCell className="text-right text-xs whitespace-nowrap text-text-3 tabular-nums">{d.closedTradeCount > 0 ? `${d.wins}W / ${d.losses}L` : "—"}</TableCell>
                          <TableCell className={cn("text-right text-[13px] tabular-nums", d.closedTradeCount > 0 ? pnlTone(d.combinedUsd) : "text-text-3")}>
                            {d.closedTradeCount > 0 ? signedUsd(d.combinedUsd) : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right text-[13px] tabular-nums", d.closedTradeCount > 0 ? pnlTone(d.combinedPercent) : "text-text-3")}>
                            {d.closedTradeCount > 0 ? formatSignedPercent(d.combinedPercent) : "—"}
                          </TableCell>
                          <TableCell className="pr-5 text-right text-[13px] tabular-nums">{d.valueUsd != null ? formatUsd(d.valueUsd) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
