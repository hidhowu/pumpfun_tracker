"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Coins, LineChart, Layers, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/traders/stat-tile";
import { WalletPerformanceChart, toChartPoints, type ChartMode } from "./wallet-performance-chart";
import { WalletOpenPositionsTable } from "./wallet-open-positions-table";
import { getWalletPnl } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
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
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function Kpi({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-text-3">{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

export function WalletPerformanceTab({ wallet }: Props) {
  const phone = !useMediaQuery("(min-width: 768px)");
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
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Balance" value={formatUsd(wallet.balanceUsd)} icon={WalletIcon} hint={`of ${formatUsd(wallet.startingBalanceUsd)} starting`} />
        <StatTile
          label="Lifetime realized P&L"
          value={signedUsd(wallet.realizedPnlUsd)}
          icon={Coins}
          tone={wallet.realizedPnlUsd > 0 ? "positive" : wallet.realizedPnlUsd < 0 ? "negative" : "default"}
          hint={
            <>
              <span className="md:hidden">incl. open buy fees</span>
              <span className="max-md:hidden">after all fees - incl. buy fees of open positions</span>
            </>
          }
        />
        <StatTile label="Open positions" value={String(wallet.openPositionCount)} icon={Layers} />
        <StatTile label="Total trades" value={String(totalTrades)} icon={LineChart} hint={`${wallet.closedPositionCount} closed`} />
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

      <WalletOpenPositionsTable walletId={wallet._id} />
    </div>
  );
}
