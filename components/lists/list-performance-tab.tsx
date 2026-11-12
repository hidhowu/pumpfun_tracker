"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Coins, LineChart, Users, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/traders/stat-tile";
import { WalletPerformanceChart, toChartPoints, type ChartMode } from "@/components/wallets/wallet-performance-chart";
import { getListPnl } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
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

const MODES = [
  { value: "value", label: "Value" },
  { value: "pnl", label: "P&L" },
] as const;
const PERIODS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

const tone = (n: number | null | undefined) => (n != null && n > 0 ? "text-positive" : n != null && n < 0 ? "text-negative" : undefined);
const whole = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function Kpi({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-text-3">{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

/**
 * A list's combined performance on one profile: every closed trade and daily
 * snapshot its traders have on that profile (their whole history, unlike a
 * wallet which only counts activity since a trader was added to it).
 */
export function ListPerformanceTab({ listId, profileId }: { listId: string; profileId: string }) {
  const phone = !useMediaQuery("(min-width: 768px)");
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
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label="Combined value"
          value={summary ? formatUsd(summary.currentValueUsd) : "-"}
          icon={WalletIcon}
          hint={summary ? <><span className="md:hidden">of {whole(summary.startingUsd)} · {whole(summary.balanceUsd)} cash</span><span className="max-md:hidden">of {formatUsd(summary.startingUsd)} starting · {formatUsd(summary.balanceUsd)} cash</span></> : undefined}
        />
        <StatTile
          label="Overall P&L"
          value={totalPnl !== null ? signedUsd(totalPnl) : "-"}
          icon={Coins}
          tone={totalPnl ? (totalPnl > 0 ? "positive" : "negative") : "default"}
          hint={<><span className="md:hidden">incl. open positions</span><span className="max-md:hidden">value now vs starting, incl. open positions</span></>}
        />
        <StatTile
          label="Lifetime realized P&L"
          value={summary ? signedUsd(summary.realizedPnlUsd) : "-"}
          icon={LineChart}
          tone={summary ? (summary.realizedPnlUsd > 0 ? "positive" : summary.realizedPnlUsd < 0 ? "negative" : "default") : "default"}
          hint={summary ? `${summary.closedPositionCount} closed · ${summary.openPositionCount} open` : undefined}
        />
        <StatTile label="Traders" value={summary ? String(summary.traderCount) : "-"} icon={Users} />
      </div>

      <div className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 md:px-5">
          <b className="flex items-center gap-2 text-[15px] font-semibold">
            <LineChart className="size-4 text-primary" />
            {copy.title}
            <HelpTip className="ml-0">{copy.description}</HelpTip>
          </b>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            <Segmented options={MODES} value={mode} onChange={setMode} label="Chart shows" block={phone} tall={phone} />
            <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Period" block={phone} tall={phone} />
          </div>
        </div>

        <div className="flex flex-col gap-4 p-4 md:p-5">
          {period === "day" && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size={phone ? "icon-lg" : "icon-sm"} aria-label="Previous day" onClick={() => setDayDate(addDaysUtc(dayDate, -1))}>
                <ChevronLeft />
              </Button>
              <span className="min-w-[150px] text-center text-sm font-medium tabular-nums">
                {dayDate}
                {isToday && <span className="ml-1.5 text-xs font-normal text-text-3">(today)</span>}
              </span>
              <Button variant="outline" size={phone ? "icon-lg" : "icon-sm"} aria-label="Next day" disabled={isToday} onClick={() => setDayDate(addDaysUtc(dayDate, 1))}>
                <ChevronRight />
              </Button>
              {!isToday && (
                <Button variant="outline" size={phone ? "lg" : "sm"} onClick={() => setDayDate(todayUtc())}>
                  Today
                </Button>
              )}
            </div>
          )}

          {loading && !pnl ? (
            <Skeleton className="h-56 w-full rounded-xl" />
          ) : pnl ? (
            <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
              <WalletPerformanceChart points={toChartPoints(pnl)} mode={mode} />
            </div>
          ) : null}

          {pnl && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-5">
              <Kpi label="Period P&L" value={pnl.actualizedUsd != null ? signedUsd(pnl.actualizedUsd) : "—"} className={tone(pnl.actualizedUsd)} />
              <Kpi label="Realized P&L" value={signedUsd(pnl.combinedUsd)} className={tone(pnl.combinedUsd)} />
              <Kpi label="Closed trades" value={pnl.closedTradeCount} />
              <Kpi label="Win rate" value={pnl.winRatePercent != null ? `${pnl.winRatePercent.toFixed(0)}%` : "—"} />
              <Kpi label="Current streak" value={streak && streak.type !== "none" ? `${streak.length}d ${streak.type}` : "—"} className={streak?.type === "profit" ? "text-positive" : streak?.type === "loss" ? "text-negative" : undefined} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
