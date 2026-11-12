"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, History, Layers, LineChart, Loader2, Pencil, ShieldBan, SlidersHorizontal, UserPlus } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getBacktestAddress, promoteBacktestAddresses, updateBacktestAddress } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestAddressDetail } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { BlacklistDialog } from "./blacklist-dialog";
import { AddressOpenPositions } from "./address-open-positions";
import { AddressPnlPanel } from "./address-pnl-panel";
import { AddressStrategyPanel } from "./address-strategy-panel";
import { AddressTradeHistory } from "./address-trade-history";
import { AddressQualityCard } from "./address-quality-card";
import { AddressWalletCard } from "./address-wallet-card";
import { LossDepthCard } from "./loss-depth-card";
import { ProgressBar, RunStatusBadge, StageBadge, formatDate, stageDescription } from "./shared";

const ACTIVE = new Set(["queued", "running"]);

const TABS = [
  { value: "simulation", label: "Simulation", short: "Sim", icon: Layers },
  { value: "history", label: "Trade History", short: "History", icon: History },
  { value: "pnl", label: "P&L", short: "P&L", icon: LineChart },
  { value: "settings", label: "Settings", short: "Settings", icon: SlidersHorizontal },
] as const;

/**
 * One address of a backtest, laid out like a live trader's page: header,
 * simulated capital, then Simulation / Trade History / P&L / Settings tabs.
 * Polls while the backtest is running so partial results keep appearing.
 */
export function AddressDashboard({ runId, address }: { runId: string; address: string }) {
  const [detail, setDetail] = useState<BacktestAddressDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const d = await getBacktestAddress(runId, address);
      setDetail(d);
      setRefreshKey((k) => k + 1);
      loaded.current = true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/not found/i.test(message)) setNotFound(true);
      else if (!loaded.current) toast.error(message || "Failed to load this address");
    }
  }, [runId, address]);

  const active = detail ? ACTIVE.has(detail.run.status) || detail.run.control !== "run" || (detail.trader.stage !== "done" && detail.trader.stage !== "failed" && detail.trader.stage !== "skipped") : true;

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(refresh, active ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [refresh, active]);

  async function saveLabel() {
    setEditingLabel(false);
    if (!detail || labelDraft.trim() === detail.trader.label) return;
    try {
      await updateBacktestAddress(address, { label: labelDraft.trim() });
      setDetail({ ...detail, trader: { ...detail.trader, label: labelDraft.trim() } });
      toast.success("Label updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update label");
    }
  }

  async function promote() {
    setPromoting(true);
    try {
      const { added, skipped, blacklisted } = await promoteBacktestAddresses(runId, [address]);
      toast.success(added.length ? "Added to live Traders" : skipped.length ? "Already tracked as a live trader" : blacklisted.length ? "Blacklisted live - not re-added" : "Nothing added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add to Traders");
    } finally {
      setPromoting(false);
    }
  }

  const back = (
    <Link href={`/backtest/${runId}`} className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
      <ChevronLeft className="size-3.5" /> Back to backtest
    </Link>
  );

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-[1360px] flex-col items-start gap-3">
        {back}
        <p className="text-sm text-text-2">This address isn&apos;t part of that backtest (it may have been deleted).</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        {back}
        <Skeleton className="h-40 w-full rounded-[20px]" />
        <Skeleton className="h-40 w-full rounded-[20px]" />
        <Skeleton className="h-64 w-full rounded-[20px]" />
      </div>
    );
  }

  const { run, trader, wallet } = detail;
  const settled = trader.stage === "done" || trader.stage === "failed" || trader.stage === "skipped";
  const depth = detail.lossDepth;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      {back}

      <section className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {editingLabel ? (
                <Input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={saveLabel}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveLabel();
                    if (e.key === "Escape") setEditingLabel(false);
                  }}
                  placeholder="Add a label…"
                  aria-label="Label"
                  className="h-9 w-56 max-w-full"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setLabelDraft(trader.label);
                    setEditingLabel(true);
                  }}
                  title="Click to edit the label"
                  className="group flex min-w-0 items-center gap-2 text-[20px] leading-7 font-semibold tracking-[-0.015em] hover:text-primary"
                >
                  <span className="truncate">{trader.label || "Unlabeled address"}</span>
                  <Pencil className="size-3.5 shrink-0 text-text-3 group-hover:text-primary" />
                </button>
              )}
              <StageBadge stage={trader.stage} />
            </div>
            <span className="flex items-center gap-1 font-mono text-xs break-all text-text-2">
              {address}
              <CopyButton value={address} label="address" />
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 max-md:w-full">
            <Button variant="outline" className="gap-1.5 max-md:h-11 max-md:flex-1" disabled={promoting} onClick={promote}>
              {promoting ? <Loader2 className="animate-spin" /> : <UserPlus />}
              Add to live Traders
            </Button>
            <Button variant="outline" className="gap-1.5 text-negative hover:text-negative max-md:h-11" onClick={() => setBlacklistOpen(true)}>
              <ShieldBan /> Blacklist
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-text-2">
          <Link href={`/backtest/${runId}`} className="font-semibold text-foreground hover:text-primary">
            {run.name}
          </Link>
          <RunStatusBadge status={run.status} control={run.control} />
          <span>
            {run.days}-day window ({formatDate(run.windowStart)} – {formatDate(run.windowEnd)}) · following &quot;{run.profileName}&quot;
          </span>
        </div>

        {!settled && (
          <div className="flex flex-col gap-2">
            <ProgressBar percent={trader.progressPercent} />
            <span className="text-xs text-text-3">
              {trader.progressPercent.toFixed(0)}% · {stageDescription(trader)} — results below fill in as trades finish.
            </span>
          </div>
        )}
        {trader.error && <span className="text-xs break-words text-negative">{trader.error}</span>}
        {trader.stage === "done" && trader.collect.signaturesFailed > 0 && <span className="text-xs text-warn">{trader.collect.signaturesFailed} transaction(s) couldn&apos;t be fetched — results may be incomplete.</span>}
      </section>

      <BlacklistDialog open={blacklistOpen} onOpenChange={setBlacklistOpen} addresses={[address]} onDone={() => {}} />

      <AddressWalletCard wallet={wallet} />

      <AddressQualityCard daily={trader.stats.daily} />

      {/* Deepest loss: the whole card on wide screens, one folded line on phones. */}
      <div className="max-md:hidden">
        <LossDepthCard depth={depth} />
      </div>
      <div className="overflow-hidden rounded-[16px] border border-border bg-card md:hidden">
        <button type="button" onClick={() => setLossOpen((v) => !v)} aria-expanded={lossOpen} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[15px] font-semibold">Deepest loss</b>
            <span className="text-xs text-text-3">
              {depth.lowest ? formatUsd(depth.lowest.pnlUsd) : "Never below zero"} · {depth.belowZero.toLocaleString()} / {depth.trades.toLocaleString()} starting trades below zero
            </span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", lossOpen && "rotate-180")} />
        </button>
        {lossOpen && (
          <div className="border-t border-border p-2">
            <LossDepthCard depth={depth} />
          </div>
        )}
      </div>

      <Tabs defaultValue="simulation" className="flex flex-col gap-4 md:gap-5">
        {/* Wide screens: underlined tabs with icons. */}
        <TabsList variant="line" className="hidden h-11 w-full gap-1 border-b border-border p-0 md:flex">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-11 flex-none gap-2 rounded-none px-3.5 text-sm font-medium after:inset-x-2.5 group-data-horizontal/tabs:after:bottom-0 data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
            >
              <t.icon className="size-3.5" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Phone: four equal buttons. */}
        <TabsList className="grid h-auto w-full grid-cols-4 md:hidden">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="h-11 justify-center px-0">
              {t.short}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="simulation" className="flex flex-col gap-6">
          <AddressOpenPositions runId={runId} address={address} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="history">
          <AddressTradeHistory runId={runId} address={address} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="pnl">
          <AddressPnlPanel runId={runId} address={address} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="settings">
          <AddressStrategyPanel detail={detail} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
