"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, LineChart, Layers, Wallet as WalletIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/traders/stat-tile";
import { WalletPerformanceChart } from "./wallet-performance-chart";
import { WalletOpenPositionsTable } from "./wallet-open-positions-table";
import { getWalletPnl } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { WalletPnlBreakdown, WalletView } from "@/lib/types";

type Props = { wallet: WalletView };
type Period = "day" | "week" | "month";

export function WalletPerformanceTab({ wallet }: Props) {
  const [period, setPeriod] = useState<Period>("week");
  const [pnl, setPnl] = useState<WalletPnlBreakdown | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (p: Period) => {
      setLoading(true);
      try {
        const res = await getWalletPnl(wallet._id, p);
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
    load(period);
  }, [load, period]);

  const totalTrades = wallet.openPositionCount + wallet.closedPositionCount;
  const streak = pnl?.streaks.currentStreak;

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
              <LineChart className="size-4 text-primary" /> Wallet value over time
            </CardTitle>
            <CardDescription>Balance + open-position value, start vs end of each day.</CardDescription>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading && !pnl ? (
            <Skeleton className="h-56 w-full" />
          ) : pnl ? (
            <WalletPerformanceChart dailyBreakdown={pnl.dailyBreakdown} />
          ) : null}

          {pnl && (
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border/60 pt-4 sm:grid-cols-4">
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
