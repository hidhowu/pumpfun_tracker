"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, History, LineChart, Layers, SlidersHorizontal } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TraderHeader } from "@/components/traders/trader-header";
import { SimBalanceCard } from "@/components/traders/sim-balance-card";
import { OpenPositionsTable } from "@/components/traders/open-positions-table";
import { TradeHistoryList } from "@/components/traders/trade-history-list";
import { PnlBreakdown } from "@/components/traders/pnl-breakdown";
import { TraderSettingsPanel } from "@/components/traders/trader-settings-panel";
import { getTrader } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { cn } from "@/lib/utils";
import type { TraderDetail } from "@/lib/types";

const POLL_INTERVAL_MS = 10_000;

const TABS = [
  { value: "simulation", label: "Simulation", short: "Sim", icon: Layers },
  { value: "history", label: "Trade History", short: "History", icon: History },
  { value: "pnl", label: "P&L", short: "P&L", icon: LineChart },
  { value: "settings", label: "Settings", short: "Settings", icon: SlidersHorizontal },
] as const;

export default function TraderDetailPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;
  const { currentProfileId } = useProfile();

  const [trader, setTrader] = useState<TraderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { trader } = await getTrader(currentProfileId, address);
      setTrader(trader);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trader");
    } finally {
      setLoading(false);
    }
  }, [address, currentProfileId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <Link href="/" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Back to traders
      </Link>

      {loading && !trader ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 w-full rounded-[20px]" />
          <Skeleton className="h-40 w-full rounded-[20px]" />
          <Skeleton className="h-64 w-full rounded-[20px]" />
        </div>
      ) : error && !trader ? (
        <div role="alert" className="rounded-[14px] border border-destructive/30 bg-neg-soft p-5 text-sm text-[#ffc9d0]">
          {error}
        </div>
      ) : trader ? (
        <>
          <TraderHeader trader={trader} onUpdated={setTrader} />
          <SimBalanceCard trader={trader} onAdjusted={setTrader} />

          <Tabs defaultValue="simulation" className="flex flex-col gap-4 md:gap-5">
            {/* Wide screens: underlined tabs with icons (and the trade count). */}
            <TabsList variant="line" className="hidden h-11 w-full gap-1 border-b border-border p-0 md:flex">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="h-11 flex-none gap-2 rounded-none px-3.5 text-sm font-medium after:inset-x-2.5 group-data-horizontal/tabs:after:bottom-0 data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                  {t.value === "history" ? <span className="rounded-full bg-surface-3 px-1.5 py-px text-[11px] font-normal text-text-2">{trader.sim.closedPositionCount}</span> : null}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* Phone: four equal buttons. */}
            <TabsList className="grid h-auto w-full grid-cols-4 md:hidden">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className={cn("h-11 justify-center px-0")}>
                  {t.short}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="simulation" className="flex flex-col gap-6">
              <OpenPositionsTable address={trader.address} />
            </TabsContent>

            <TabsContent value="history">
              <TradeHistoryList address={trader.address} />
            </TabsContent>

            <TabsContent value="pnl">
              <PnlBreakdown address={trader.address} />
            </TabsContent>

            <TabsContent value="settings">
              <TraderSettingsPanel
                address={trader.address}
                settings={trader.settings}
                effectiveSettings={trader.effectiveSettings}
                onUpdated={({ settings, effectiveSettings }) => setTrader((prev) => (prev ? { ...prev, settings, effectiveSettings } : prev))}
                onReset={setTrader}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
