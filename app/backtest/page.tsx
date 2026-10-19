"use client";

import { FlaskConical, ListPlus } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddressesTab } from "@/components/backtest/addresses-tab";
import { RunsTab } from "@/components/backtest/runs-tab";
import { BacktestSettingsDialog } from "@/components/backtest/settings-dialog";
import { WorkerStatus } from "@/components/backtest/worker-status";

/** Test addresses against their past trades instead of waiting days for live results. */
export default function BacktestPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Backtest</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Replay an address&apos;s last N days of pump.fun trades as if you had copy-traded them with a profile&apos;s settings - same dust rules, the
            same execution delay and fees - and see which addresses are worth tracking live, without waiting for days of live results.
          </p>
        </div>
        <BacktestSettingsDialog />
      </div>

      <WorkerStatus />

      <Tabs defaultValue="runs" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="runs" className="gap-1.5">
            <FlaskConical className="size-3.5" /> Backtests
          </TabsTrigger>
          <TabsTrigger value="addresses" className="gap-1.5">
            <ListPlus className="size-3.5" /> Addresses
          </TabsTrigger>
        </TabsList>
        <TabsContent value="runs">
          <RunsTab />
        </TabsContent>
        <TabsContent value="addresses">
          <AddressesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
