"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Coins, LineChart, Users, Wallet as WalletIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/traders/stat-tile";
import { WalletPerformanceChart, toChartPoints, type ChartMode } from "@/components/wallets/wallet-performance-chart";
import { getListPnl } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { ListPnlBreakdown } from "@/lib/types";

type Period = "day" | "week" | "month";

const todayUtc = () => new Date().toISOString().slice(0, 10);
const POLL_INTERVAL_MS = 30_000;

function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MODE_COPY: Record<ChartMode, Record<Period, { title: string; description: string }>> = {
  value: {
    day: { title: "Combined value by hour", description: "All the list's traders' balances + open-position value, hour by hour (UTC)." },
    week: { title: "Combined value over time", description: "All the list's traders' balances + open-position value, per day." },
    month: { title: "Combined value over time", description: "All the list's traders' balances + open-position value, per day." },
  },
  pnl: {
    day: { title: "Realized P&L by hour", description: "P&L of the list's trades that closed in each hour (UTC)." },
    week: { title: "Daily realized P&L", description: "P&L of the list's trades that closed on each day (UTC)." },
    month: { title: "Daily realized P&L", description: "P&L of the list's trades that closed on each day (UTC)." },
  },
};

const tone = (n: number | null | undefined) => (n != null && n > 0 ? "text-positive" : n != null && n < 0 ? "text-negative" : undefined);

/**
 * A list's combined performance on one profile: every closed trade and daily
 * snapshot its traders have on that profile (their whole history, unlike a
 * wallet which only counts activity since a trader was added to it).
 */
export function ListPerformanceTab({ listId, profileId }: { listId: string; profileId: string }) {
  const [period, setPeriod] = useState<Period>("week");
  const [mode, setMode] = useState<ChartMode>("value");
  const [dayDate, setDayDate] = useState<string>(todayUtc);
  const [pnl, setPnl] = useState<ListPnlBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setPnl(await getListPnl(listId, profileId, period, period === "day" ? dayDate : undefined));
      } catch (e) {
        if (!silent) toast.error(e instanceof Error ? e.message : "Failed to load list performance");
      } finally {
        setLoading(false);
      }
    },
    [listId, profileId, period, dayDate]
  );

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const summary = pnl?.summary;
  const streak = pnl?.streaks.currentStreak;
  const copy = MODE_COPY[mode][period];
  const isToday = dayDate >= todayUtc();
  const totalPnl = summary ? summary.currentValueUsd - summary.startingUsd : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Combined value"
          value={summary ? formatUsd(summary.currentValueUsd) : "-"}
          icon={WalletIcon}
          hint={summary ? `of ${formatUsd(summary.startingUsd)} starting · ${formatUsd(summary.balanceUsd)} cash` : undefined}
        />
        <StatTile
          label="Overall P&L"
          value={totalPnl !== null ? formatUsd(totalPnl) : "-"}
          icon={Coins}
          tone={totalPnl ? (totalPnl > 0 ? "positive" : "negative") : "default"}
          hint="value now vs starting, incl. open positions"
        />
        <StatTile
          label="Lifetime realized P&L"
          value={summary ? formatUsd(summary.realizedPnlUsd) : "-"}
          icon={LineChart}
          tone={summary ? (summary.realizedPnlUsd > 0 ? "positive" : summary.realizedPnlUsd < 0 ? "negative" : "default") : "default"}
          hint={summary ? `${summary.closedPositionCount} closed · ${summary.openPositionCount} open` : undefined}
        />
        <StatTile label="Traders" value={summary ? String(summary.traderCount) : "-"} icon={Users} />
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div>
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
            <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {period === "day" && (
            <div className="mb-3 flex items-center justify-center gap-2">
              <Button variant="ghost" size="icon-sm" aria-label="Previous day" onClick={() => setDayDate(addDaysUtc(dayDate, -1))}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="min-w-36 text-center text-sm font-medium tabular-nums">
                {dayDate}
                {isToday && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(today)</span>}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Next day" disabled={isToday} onClick={() => setDayDate(addDaysUtc(dayDate, 1))}>
                <ChevronRight className="size-4" />
              </Button>
              {!isToday && (
                <Button variant="outline" size="sm" onClick={() => setDayDate(todayUtc())}>
                  Today
                </Button>
              )}
            </div>
          )}

          {loading && !pnl ? (
            <Skeleton className="h-56 w-full" />
          ) : pnl ? (
            <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <WalletPerformanceChart points={toChartPoints(pnl)} mode={mode} />
            </div>
          ) : null}

          {pnl && (
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-5">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Period P&amp;L</span>
                <span className={["text-sm font-semibold tabular-nums", tone(pnl.actualizedUsd)].filter(Boolean).join(" ")}>
                  {pnl.actualizedUsd != null ? formatUsd(pnl.actualizedUsd) : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Realized P&amp;L</span>
                <span className={["text-sm font-semibold tabular-nums", tone(pnl.combinedUsd)].filter(Boolean).join(" ")}>
                  {formatUsd(pnl.combinedUsd)}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Closed trades</span>
                <span className="text-sm font-semibold tabular-nums">{pnl.closedTradeCount}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Win rate</span>
                <span className="text-sm font-semibold tabular-nums">{pnl.winRatePercent != null ? `${pnl.winRatePercent.toFixed(0)}%` : "—"}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Current streak</span>
                <span className="text-sm font-semibold tabular-nums">
                  {streak && streak.type !== "none" ? `${streak.length}d ${streak.type}` : "—"}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
