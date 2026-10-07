"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Coins, LineChart, Layers, Wallet as WalletIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/traders/stat-tile";
import { WalletPerformanceChart, toChartPoints, type ChartMode } from "./wallet-performance-chart";
import { WalletOpenPositionsTable } from "./wallet-open-positions-table";
import { getWalletPnl } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { WalletPnlBreakdown, WalletView } from "@/lib/types";

type Props = { wallet: WalletView };
type Period = "day" | "week" | "month";

const todayUtc = () => new Date().toISOString().slice(0, 10);

function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MODE_COPY: Record<ChartMode, Record<Period, { title: string; description: string }>> = {
  value: {
    day: { title: "Wallet value by hour", description: "Balance + open-position value, hour by hour (UTC)." },
    week: { title: "Wallet value over time", description: "Balance + open-position value, start vs end of each day." },
    month: { title: "Wallet value over time", description: "Balance + open-position value, start vs end of each day." },
  },
  pnl: {
    day: { title: "Realized P&L by hour", description: "P&L of trades that closed in each hour (UTC)." },
    week: { title: "Daily realized P&L", description: "P&L of trades that closed on each day (UTC)." },
    month: { title: "Daily realized P&L", description: "P&L of trades that closed on each day (UTC)." },
  },
};

export function WalletPerformanceTab({ wallet }: Props) {
  const [period, setPeriod] = useState<Period>("week");
  const [mode, setMode] = useState<ChartMode>("value");
  const [dayDate, setDayDate] = useState<string>(todayUtc); // only used by the Day view
  const [pnl, setPnl] = useState<WalletPnlBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: Period, date: string) => {
      setLoading(true);
      try {
        const res = await getWalletPnl(wallet._id, p, p === "day" ? date : undefined);
        setPnl(res);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load performance");
      } finally {
        setLoading(false);
      }
    },
    [wallet._id]
  );

  useEffect(() => {
    load(period, dayDate);
  }, [load, period, dayDate]);

  const totalTrades = wallet.openPositionCount + wallet.closedPositionCount;
  const streak = pnl?.streaks.currentStreak;
  const copy = MODE_COPY[mode][period];
  const isToday = dayDate >= todayUtc();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Balance"
          value={formatUsd(wallet.balanceUsd)}
          icon={WalletIcon}
          hint={`of ${formatUsd(wallet.startingBalanceUsd)} starting`}
        />
        <StatTile
          label="Lifetime realized P&L"
          value={formatUsd(wallet.realizedPnlUsd)}
          icon={Coins}
          tone={wallet.realizedPnlUsd > 0 ? "positive" : wallet.realizedPnlUsd < 0 ? "negative" : "default"}
        />
        <StatTile label="Open positions" value={String(wallet.openPositionCount)} icon={Layers} />
        <StatTile label="Total trades" value={String(totalTrades)} icon={LineChart} hint={`${wallet.closedPositionCount} closed`} />
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next day"
                disabled={isToday}
                onClick={() => setDayDate(addDaysUtc(dayDate, 1))}
              >
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
                <span
                  className={[
                    "text-sm font-semibold tabular-nums",
                    pnl.actualizedUsd != null && pnl.actualizedUsd > 0 && "text-positive",
                    pnl.actualizedUsd != null && pnl.actualizedUsd < 0 && "text-negative",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {pnl.actualizedUsd != null ? formatUsd(pnl.actualizedUsd) : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Realized P&amp;L</span>
                <span
                  className={[
                    "text-sm font-semibold tabular-nums",
                    pnl.combinedUsd > 0 && "text-positive",
                    pnl.combinedUsd < 0 && "text-negative",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
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

      <WalletOpenPositionsTable walletId={wallet._id} />
    </div>
  );
}
