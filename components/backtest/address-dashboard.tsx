"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { ArrowLeft, Check, Copy, History, LineChart, Loader2, Pencil, SlidersHorizontal, Layers, ShieldBan, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBacktestAddress, promoteBacktestAddresses, updateBacktestAddress } from "@/lib/backtest-api";
import type { BacktestAddressDetail } from "@/lib/backtest-types";
import { BlacklistDialog } from "./blacklist-dialog";
import { AddressOpenPositions } from "./address-open-positions";
import { AddressPnlPanel } from "./address-pnl-panel";
import { AddressStrategyPanel } from "./address-strategy-panel";
import { AddressTradeHistory } from "./address-trade-history";
import { AddressQualityCard } from "./address-quality-card";
import { AddressWalletCard } from "./address-wallet-card";
import { ProgressBar, RunStatusBadge, StageBadge, formatDate, stageDescription } from "./shared";

const ACTIVE = new Set(["queued", "running"]);

/**
 * One address of a backtest, laid out like a live trader's page: header,
 * simulated capital, then Simulation / Trade History / P&L / Settings tabs.
 * Polls while the backtest is running so partial results keep appearing.
 */
export function AddressDashboard({ runId, address }: { runId: string; address: string }) {
  const [detail, setDetail] = useState<BacktestAddressDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
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

  async function copyAddress() {
    if (await copyText(address)) {
      setCopied(true);
      toast.success("Address copied");
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("Couldn't copy");
    }
  }

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
    <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
      <Link href={`/backtest/${runId}`}>
        <ArrowLeft className="size-4" /> Back to backtest
      </Link>
    </Button>
  );

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-3">
        {back}
        <p className="text-sm text-muted-foreground">This address isn&apos;t part of that backtest (it may have been deleted).</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const { run, trader, wallet } = detail;
  const settled = trader.stage === "done" || trader.stage === "failed" || trader.stage === "skipped";

  return (
    <div className="flex flex-col gap-6">
      {back}

      <Card className="border-border/60">
        <CardContent className="flex flex-col gap-4 pt-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {editingLabel ? (
                  <Input
                    autoFocus
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onBlur={saveLabel}
                    onKeyDown={(e) => e.key === "Enter" && saveLabel()}
                    placeholder="Add a label…"
                    className="h-8 w-56 max-w-full"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setLabelDraft(trader.label);
                      setEditingLabel(true);
                    }}
                    className="group flex min-w-0 items-center gap-1.5 text-lg font-semibold tracking-tight hover:text-primary"
                  >
                    <span className="truncate">{trader.label || "Unlabeled address"}</span>
                    <Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                  </button>
                )}
                <StageBadge stage={trader.stage} />
              </div>
              <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <span className="break-all">{address}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button onClick={copyAddress} className="shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground" aria-label="Copy address">
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Copy address</TooltipContent>
                </Tooltip>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" disabled={promoting} onClick={promote}>
                {promoting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                Add to live Traders
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-negative hover:text-negative" onClick={() => setBlacklistOpen(true)}>
                <ShieldBan className="size-4" /> Blacklist
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Link href={`/backtest/${runId}`} className="font-medium text-foreground hover:text-primary">
              {run.name}
            </Link>
            <RunStatusBadge status={run.status} control={run.control} />
            <span>
              {run.days}-day window ({formatDate(run.windowStart)} – {formatDate(run.windowEnd)}) · following &quot;{run.profileName}&quot;
            </span>
          </div>

          {!settled && (
            <div className="flex flex-col gap-1.5">
              <ProgressBar percent={trader.progressPercent} />
              <span className="text-xs text-muted-foreground">
                {trader.progressPercent.toFixed(0)}% · {stageDescription(trader)} - results below fill in as trades finish.
              </span>
            </div>
          )}
          {trader.error && <span className="text-xs break-words text-negative">{trader.error}</span>}
          {trader.stage === "done" && trader.collect.signaturesFailed > 0 && (
            <span className="text-xs text-amber-500">{trader.collect.signaturesFailed} transaction(s) couldn&apos;t be fetched - results may be incomplete.</span>
          )}
        </CardContent>
      </Card>

      <BlacklistDialog open={blacklistOpen} onOpenChange={setBlacklistOpen} addresses={[address]} onDone={() => {}} />

      <AddressWalletCard wallet={wallet} />

      <AddressQualityCard daily={trader.stats.daily} />

      <Tabs defaultValue="simulation" className="flex flex-col gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
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
