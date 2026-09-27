"use client";

import { useEffect, useState, useCallback } from "react";
import { Flame, Snowflake, Minus, LineChart, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getPnl } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { PnlBreakdown as PnlBreakdownType } from "@/lib/types";

type Props = { address: string };
type Period = "day" | "week" | "month";

export function PnlBreakdown({ address }: Props) {
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<PnlBreakdownType | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await getPnl(address, p);
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load(period);
  }, [load, period]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="size-4 text-primary" /> P&amp;L breakdown
          </CardTitle>
          <CardDescription>Actualized (portfolio value) vs combined (closed-trade returns).</CardDescription>
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading && !data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <HeadlineStat
                label="Actualized"
                value={data.actualizedUsd !== null ? formatUsd(data.actualizedUsd) : "—"}
                hint="Start-of-period vs now, incl. open positions"
                tone={data.actualizedUsd === null ? undefined : data.actualizedUsd > 0 ? "positive" : data.actualizedUsd < 0 ? "negative" : undefined}
              />
              <HeadlineStat
                label="Combined"
                value={`${data.combinedPercent >= 0 ? "+" : ""}${data.combinedPercent.toFixed(1)}%`}
                hint="Sum of each closed trade's % return"
                tone={data.combinedPercent > 0 ? "positive" : data.combinedPercent < 0 ? "negative" : undefined}
              />
              <HeadlineStat label="Closed trades" value={String(data.closedTradeCount)} hint={`${data.averageTradesPerDay.toFixed(1)} / day avg`} />
              <StreakStat streak={data.streaks.currentStreak} />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
              <span>Profitable days: <span className="text-foreground">{data.streaks.profitableDays}</span></span>
              <span>Loss days: <span className="text-foreground">{data.streaks.lossDays}</span></span>
              <span>Longest win streak: <span className="text-foreground">{data.streaks.longestProfitStreak}d</span></span>
              <span>Longest loss streak: <span className="text-foreground">{data.streaks.longestLossStreak}d</span></span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Daily combined P&amp;L</span>
                {data.negativeBalanceBreakdown.some((d) => d.count > 0) && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-negative/80">
                    <AlertTriangle className="size-3" /> went negative
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {data.dailyBreakdown.map((day) => (
                  <DailyBar
                    key={day.date}
                    day={day}
                    negativeBalance={data.negativeBalanceBreakdown.find((n) => n.date === day.date)}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HeadlineStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={["text-lg font-semibold tabular-nums", tone === "positive" && "text-positive", tone === "negative" && "text-negative"]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </div>
  );
}

function StreakStat({ streak }: { streak: PnlBreakdownType["streaks"]["currentStreak"] }) {
  const Icon = streak.type === "profit" ? Flame : streak.type === "loss" ? Snowflake : Minus;
  const tone = streak.type === "profit" ? "text-positive" : streak.type === "loss" ? "text-negative" : "text-muted-foreground";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">Current streak</span>
          <span className={`inline-flex items-center gap-1 text-lg font-semibold tabular-nums ${tone}`}>
            <Icon className="size-4" />
            {streak.length}d
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {streak.type === "none" ? "No active streak" : `${streak.length}-day ${streak.type} streak`}
      </TooltipContent>
    </Tooltip>
  );
}

function DailyBar({
  day,
  negativeBalance,
}: {
  day: PnlBreakdownType["dailyBreakdown"][number];
  negativeBalance?: PnlBreakdownType["negativeBalanceBreakdown"][number];
}) {
  const magnitude = Math.min(100, Math.abs(day.combinedPercent));
  const isPositive = day.combinedPercent > 0;
  const isNegative = day.combinedPercent < 0;
  const wentNegative = (negativeBalance?.count ?? 0) > 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{day.date.slice(5)}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
        {day.closedTradeCount > 0 && (
          <div
            className={`absolute inset-y-0 left-0 rounded ${isPositive ? "bg-positive" : isNegative ? "bg-negative" : "bg-muted-foreground/40"}`}
            style={{ width: `${Math.max(magnitude, 2)}%` }}
          />
        )}
      </div>
      {wentNegative && negativeBalance && (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertTriangle className="size-3.5 shrink-0 text-negative" />
          </TooltipTrigger>
          <TooltipContent>
            Balance went negative {negativeBalance.count} time{negativeBalance.count === 1 ? "" : "s"} this day - deepest point{" "}
            {formatUsd(-Math.abs(negativeBalance.maxDepthUsd))}
          </TooltipContent>
        </Tooltip>
      )}
      <span
        className={[
          "w-16 shrink-0 text-right tabular-nums",
          isPositive && "text-positive",
          isNegative && "text-negative",
          !isPositive && !isNegative && "text-muted-foreground",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {day.closedTradeCount > 0 ? `${day.combinedPercent >= 0 ? "+" : ""}${day.combinedPercent.toFixed(1)}%` : "—"}
      </span>
    </div>
  );
}
