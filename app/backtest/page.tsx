"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, ListPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddressesTab } from "@/components/backtest/addresses-tab";
import { NewRunDialog } from "@/components/backtest/new-run-dialog";
import { RunsTab } from "@/components/backtest/runs-tab";
import { BacktestSettingsDialog } from "@/components/backtest/settings-dialog";
import { WorkerStatus } from "@/components/backtest/worker-status";
import { listBacktestAddresses } from "@/lib/backtest-api";
import { useMediaQuery } from "@/hooks/use-media-query";

type TabValue = "runs" | "addresses";

/** Test addresses against their past trades instead of waiting days for live results. */
export default function BacktestPage() {
  const router = useRouter();
  const phone = !useMediaQuery("(min-width: 768px)");
  const [tab, setTab] = useState<TabValue>("runs");
  const [runCount, setRunCount] = useState<number | null>(null);
  const [addressCount, setAddressCount] = useState<number | null>(null);
  const [newRunOpen, setNewRunOpen] = useState(false);

  // How many addresses are on the list (the tab badge, and what "all on the list" means for a new backtest started from here).
  const loadAddressCount = useCallback(async () => {
    try {
      const page = await listBacktestAddresses({ page: 1, limit: 1 });
      setAddressCount(page.totalAll);
    } catch {
      // the badge just stays as it was
    }
  }, []);

  useEffect(() => {
    loadAddressCount();
    const interval = setInterval(loadAddressCount, 20_000);
    return () => clearInterval(interval);
  }, [loadAddressCount]);

  const tabOptions = [
    { value: "runs", label: <>Backtests{runCount !== null ? <span className="ml-1.5 text-text-3">{runCount}</span> : null}</> },
    { value: "addresses", label: <>Addresses{addressCount !== null ? <span className="ml-1.5 text-text-3">{addressCount.toLocaleString()}</span> : null}</> },
  ] as const;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="hidden text-[28px] leading-[34px] font-semibold tracking-[-0.025em] md:block">
          Backtest
          <HelpTip>Replays an address&apos;s past trades with a profile&apos;s settings, to see who is worth tracking live.</HelpTip>
        </h1>
        <span className="flex items-center gap-1 text-[13px] text-text-3 md:hidden">
          Replay past trades
          <HelpTip>Replays an address&apos;s past trades with a profile&apos;s settings, to see who is worth tracking live.</HelpTip>
        </span>
        <div className="flex items-center gap-2">
          <BacktestSettingsDialog />
          <Button className="gap-1.5 max-md:hidden" onClick={() => setNewRunOpen(true)}>
            <Plus className="size-4" strokeWidth={2.2} /> New backtest
          </Button>
        </div>
      </div>

      <WorkerStatus />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="flex flex-col gap-4 md:gap-5">
        {/* Wide screens: underlined tabs with icons and counts. */}
        <TabsList variant="line" className="hidden h-11 w-full gap-1 border-b border-border p-0 md:flex">
          {(
            [
              { value: "runs", label: "Backtests", icon: FlaskConical, count: runCount },
              { value: "addresses", label: "Addresses", icon: ListPlus, count: addressCount },
            ] as const
          ).map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-11 flex-none gap-2 rounded-none px-3.5 text-sm font-medium after:inset-x-2.5 group-data-horizontal/tabs:after:bottom-0 data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
            >
              <t.icon className="size-3.5" />
              {t.label}
              {t.count !== null ? <span className="rounded-full bg-surface-3 px-1.5 py-px text-[11px] font-normal text-text-2">{t.count.toLocaleString()}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Phone: two equal buttons. */}
        <div className="md:hidden">
          <Segmented options={tabOptions} value={tab} onChange={setTab} label="Section" block tall />
        </div>
        {phone && tab === "runs" ? (
          <Button size="lg" className="w-full gap-1.5" onClick={() => setNewRunOpen(true)}>
            <Plus className="size-4" strokeWidth={2.2} /> New backtest
          </Button>
        ) : null}

        <TabsContent value="runs">
          <RunsTab onCount={setRunCount} onGoToAddresses={() => setTab("addresses")} />
        </TabsContent>
        <TabsContent value="addresses">
          <AddressesTab />
        </TabsContent>
      </Tabs>

      <NewRunDialog open={newRunOpen} onOpenChange={setNewRunOpen} selected={[]} allCount={addressCount ?? 0} onCreated={(id) => router.push(`/backtest/${id}`)} />
    </div>
  );
}
