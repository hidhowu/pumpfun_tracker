"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Info, LineChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyBar, HeadlineStat, StreakStat } from "@/components/traders/pnl-breakdown";
import { WalletPerformanceChart, toChartPoints, type ChartMode } from "@/components/wallets/wallet-performance-chart";
import { getBacktestAddressPnl } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestAddressPnl, BacktestPnlPeriod } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
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

const PERIODS: Array<{ value: BacktestPnlPeriod; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All" },
];

/** The address's results over time - the live trader's P&L tab (headline numbers, streaks, daily bars) plus the wallet value / P&L charts of a live wallet. */
export function AddressPnlPanel({ runId, address, refreshKey }: { runId: string; address: string; refreshKey: number }) {
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

  return (
    <div className="flex flex-col gap-6">
      {stillRunning && pnl && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            {pnl.through ? `Days before ${pnl.through} are complete - ` : "Nothing is complete yet - "}
            the rest are still filling in, so their numbers can still change.
          </span>
        </div>
      )}

      <Card className="border-border/60">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <LineChart className="size-4 text-primary" /> {copy.title}
            </CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={mode} onValueChange={(v) => setMode(v as ChartMode)}>
              <TabsList>
                <TabsTrigger value="value">Value</TabsTrigger>
                <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={period}
              onValueChange={(v) => {
                setPeriod(v as BacktestPnlPeriod);
                setPnl(null);
              }}
            >
              <TabsList>
                {PERIODS.map((p) => (
                  <TabsTrigger key={p.value} value={p.value}>
                    {p.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {period === "day" && shownDay && (
            <div className="mb-3 flex items-center justify-center gap-2">
              <Button variant="ghost" size="icon-sm" aria-label="Previous day" disabled={atFirstDay} onClick={() => setDayDate(addDaysUtc(shownDay, -1))}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-36 text-center text-sm font-medium tabular-nums">{shownDay}</span>
              <Button variant="ghost" size="icon-sm" aria-label="Next day" disabled={atLastDay} onClick={() => setDayDate(addDaysUtc(shownDay, 1))}>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}

          {pnl === null ? <Skeleton className="h-56 w-full" /> : <WalletPerformanceChart points={toChartPoints(pnl)} mode={mode} />}

          {pnl && (
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-5">
              <Mini label="Period P&L" value={pnl.actualizedUsd != null ? formatUsd(pnl.actualizedUsd) : "—"} tone={pnl.actualizedUsd} />
              <Mini label="Realized P&L" value={formatUsd(pnl.combinedUsd)} tone={pnl.combinedUsd} />
              <Mini label="Closed trades" value={String(pnl.closedTradeCount)} />
              <Mini label="Win rate" value={pnl.winRatePercent != null ? `${pnl.winRatePercent.toFixed(0)}%` : "—"} />
              <Mini label="Current streak" value={pnl.streaks.currentStreak.type !== "none" ? `${pnl.streaks.currentStreak.length}d ${pnl.streaks.currentStreak.type}` : "—"} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4 text-primary" /> Day by day
          </CardTitle>
          <CardDescription>Which days made money and which lost it, over the same period as the chart above.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {pnl === null ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <HeadlineStat
                  label="Actualized"
                  value={pnl.actualizedUsd !== null ? formatUsd(pnl.actualizedUsd) : "—"}
                  hint="Start-of-period vs end, incl. open trades"
                  tone={pnl.actualizedUsd === null ? undefined : pnl.actualizedUsd > 0 ? "positive" : pnl.actualizedUsd < 0 ? "negative" : undefined}
                />
                <HeadlineStat
                  label="Combined"
                  value={`${pnl.combinedPercent >= 0 ? "+" : ""}${pnl.combinedPercent.toFixed(1)}%`}
                  hint="Sum of each closed trade's % return"
                  tone={pnl.combinedPercent > 0 ? "positive" : pnl.combinedPercent < 0 ? "negative" : undefined}
                />
                <HeadlineStat label="Closed trades" value={String(pnl.closedTradeCount)} hint={`${pnl.averageTradesPerDay.toFixed(1)} / day avg`} />
                <StreakStat streak={pnl.streaks.currentStreak} />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
                <span>
                  Profitable days: <span className="text-foreground">{pnl.streaks.profitableDays}</span>
                </span>
                <span>
                  Loss days: <span className="text-foreground">{pnl.streaks.lossDays}</span>
                </span>
                <span>
                  Longest win streak: <span className="text-foreground">{pnl.streaks.longestProfitStreak}d</span>
                </span>
                <span>
                  Longest loss streak: <span className="text-foreground">{pnl.streaks.longestLossStreak}d</span>
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Daily combined P&amp;L</span>
                  {negativeDays && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-negative/80">
                      <AlertTriangle className="size-3" /> went negative
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {pnl.dailyBreakdown.map((day) => (
                    <DailyBar key={day.date} day={day} negativeBalance={pnl.negativeBalanceBreakdown.find((n) => n.date === day.date)} />
                  ))}
                </div>
              </div>

              {daysWithTrades > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/60 hover:bg-transparent">
                        <TableHead>Day</TableHead>
                        <TableHead className="text-right">Trades</TableHead>
                        <TableHead className="text-right">W / L</TableHead>
                        <TableHead className="text-right">P&amp;L</TableHead>
                        <TableHead className="text-right">Combined</TableHead>
                        <TableHead className="pr-4 text-right">Wallet value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...pnl.dailyBreakdown].reverse().map((d) => (
                        <TableRow key={d.date} className="border-border/60">
                          <TableCell className="text-xs whitespace-nowrap">{d.date}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.closedTradeCount}</TableCell>
                          <TableCell className="text-right text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                            {d.closedTradeCount > 0 ? `${d.wins}W / ${d.losses}L` : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right tabular-nums", d.closedTradeCount > 0 ? pnlTone(d.combinedUsd) : "text-muted-foreground")}>
                            {d.closedTradeCount > 0 ? formatUsd(d.combinedUsd) : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right tabular-nums", d.closedTradeCount > 0 ? pnlTone(d.combinedPercent) : "text-muted-foreground")}>
                            {d.closedTradeCount > 0 ? formatSignedPercent(d.combinedPercent, 1) : "—"}
                          </TableCell>
                          <TableCell className="pr-4 text-right tabular-nums">{d.valueUsd != null ? formatUsd(d.valueUsd) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", pnlTone(tone))}>{value}</span>
    </div>
  );
}
