"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, History, LineChart, Layers, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TraderHeader } from "@/components/traders/trader-header";
import { SimBalanceCard } from "@/components/traders/sim-balance-card";
import { OpenPositionsTable } from "@/components/traders/open-positions-table";
import { TradeHistoryList } from "@/components/traders/trade-history-list";
import { PnlBreakdown } from "@/components/traders/pnl-breakdown";
import { TraderSettingsPanel } from "@/components/traders/trader-settings-panel";
import { getTrader } from "@/lib/api";
import type { TraderDetail } from "@/lib/types";

const POLL_INTERVAL_MS = 10_000;

export default function TraderDetailPage() {
  const params = useParams<{ address: string }>();
  const address = params.address;

  const [trader, setTrader] = useState<TraderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { trader } = await getTrader(address);
      setTrader(trader);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trader");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit -ml-2 text-muted-foreground">
        <Link href="/">
          <ArrowLeft className="size-4" /> Back to traders
        </Link>
      </Button>

      {loading && !trader ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : error && !trader ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
          {error}
        </div>
      ) : trader ? (
        <>
          <TraderHeader trader={trader} onUpdated={setTrader} />
          <SimBalanceCard trader={trader} onAdjusted={setTrader} />

          <Tabs defaultValue="simulation" className="flex flex-col gap-4">
            <TabsList>
              <TabsTrigger value="simulation" className="gap-1.5">
                <Layers className="size-3.5" /> Simulation
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="size-3.5" /> Trade History
              </TabsTrigger>
              <TabsTrigger value="pnl" className="gap-1.5">
                <LineChart className="size-3.5" /> P&amp;L
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5">
                <SlidersHorizontal className="size-3.5" /> Settings
              </TabsTrigger>
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
                onUpdated={({ settings, effectiveSettings }) =>
                  setTrader((prev) => (prev ? { ...prev, settings, effectiveSettings } : prev))
                }
                onReset={setTrader}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
