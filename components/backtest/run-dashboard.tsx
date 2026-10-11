"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, CheckCheck, Clock, Coins, Loader2, PauseCircle, PlayCircle, RotateCcw, Target, Trash2, TrendingUp, ShieldBan, UserPlus, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatTile } from "@/components/traders/stat-tile";
import { controlBacktestRun, deleteBacktestAddresses, deleteBacktestRun, getBacktestRun, promoteBacktestAddresses } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestRunDetail } from "@/lib/backtest-types";
import { DailyGrid } from "./daily-grid";
import { EquityChart } from "./equity-chart";
import { PositionsTable } from "./positions-table";
import { RunTradersTable } from "./run-traders-table";
import { WorkerStatus } from "./worker-status";
import { BlacklistDialog } from "./blacklist-dialog";
import { ProgressBar, RunStatusBadge, StrategyChips, formatDate, formatDuration, formatSignedPercent } from "./shared";

const ACTIVE = new Set(["queued", "running"]);

type Confirm = null | "cancel" | "delete" | "remove-addresses";

/** One backtest: live progress, headline numbers, every address's partial results, daily grid, chart and trades. */
export function RunDashboard({ runId }: { runId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<BacktestRunDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Bumped on every poll while the run is active, so the chart / daily grid / trade list below re-read as results arrive.
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const lastStatus = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await getBacktestRun(runId);
      setDetail(d);
      setRefreshKey((k) => k + 1);
      // The poll that notices a run just finished is the last one that needs to refetch the charts - already covered by the bump above.
      lastStatus.current = d.run.status;
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/not found/i.test(message)) setNotFound(true);
      else if (lastStatus.current === null) toast.error(message || "Failed to load the backtest");
    }
  }, [runId]);

  const active = detail ? ACTIVE.has(detail.run.status) || detail.run.control !== "run" : true;

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(refresh, active ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [refresh, active]);

  async function act(action: "pause" | "resume" | "cancel" | "retry_failed") {
    setBusy(action);
    try {
      await controlBacktestRun(runId, action);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await deleteBacktestRun(runId);
      toast.success("Backtest deleted");
      router.push("/backtest");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
      setBusy(null);
      setConfirm(null);
    }
  }

  async function promote() {
    setBusy("promote");
    try {
      const { added, skipped, blacklisted } = await promoteBacktestAddresses(runId, [...selected]);
      const parts = [`${added.length} added to Traders`];
      if (skipped.length) parts.push(`${skipped.length} already tracked`);
      if (blacklisted.length) parts.push(`${blacklisted.length} blacklisted (not re-added)`);
      toast.success(parts.join(", "));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add to Traders");
    } finally {
      setBusy(null);
    }
  }

  async function removeAddresses() {
    setBusy("remove-addresses");
    try {
      const { deletedCount } = await deleteBacktestAddresses([...selected]);
      toast.success(`Removed ${deletedCount} address${deletedCount === 1 ? "" : "es"} from the backtest list`);
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link href="/backtest">
            <ArrowLeft className="size-4" /> Back to backtests
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">This backtest doesn&apos;t exist (it may have been deleted).</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { run, progress, stats, traders } = detail;
  const running = ACTIVE.has(run.status);
  const canPause = running && run.control === "run";
  const canResume = run.status === "paused";
  const canCancel = (running && run.control === "run") || run.status === "paused";
  const failedCount = progress.addressesFailed;
  const settled = !running && run.status !== "paused";
  const pct = progress.percent;

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
        <Link href="/backtest">
          <ArrowLeft className="size-4" /> Back to backtests
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{run.name}</h1>
            <RunStatusBadge status={run.status} control={run.control} />
          </div>
          <p className="text-sm text-muted-foreground">
            {run.days}-day window ({formatDate(run.windowStart)} – {formatDate(run.windowEnd)}) · following &quot;{run.profileName}&quot; · {run.addresses.length} address
            {run.addresses.length === 1 ? "" : "es"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPause && (
            <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => act("pause")}>
              <PauseCircle className="size-4" /> Pause
            </Button>
          )}
          {canResume && (
            <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => act("resume")}>
              <PlayCircle className="size-4" /> Resume
            </Button>
          )}
          {settled && failedCount > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => act("retry_failed")}>
              <RotateCcw className="size-4" /> Retry {failedCount} failed
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" size="sm" className="gap-1.5 text-negative hover:text-negative" disabled={busy !== null} onClick={() => setConfirm("cancel")}>
              <XCircle className="size-4" /> Cancel
            </Button>
          )}
          {!running && (
            <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground hover:text-negative" disabled={busy !== null} onClick={() => setConfirm("delete")}>
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      {running && <WorkerStatus />}

      <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">{pct.toFixed(pct >= 99.95 || pct === 0 ? 0 : 1)}%</span>
          <span className="text-sm text-muted-foreground">
            {progress.addressesDone}/{progress.addressesTotal} addresses done{failedCount > 0 ? ` · ${failedCount} failed` : ""}{progress.addressesSkipped > 0 ? ` · ${progress.addressesSkipped} skipped` : ""}
          </span>
        </div>
        <ProgressBar percent={pct} tone={run.status === "failed" ? "negative" : run.status === "completed" ? "positive" : "primary"} className="h-2" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Worked for {formatDuration(run.activeMs)}</span>
          {running && <span>{progress.etaMs != null ? `About ${formatDuration(progress.etaMs)} left` : "Estimating time left…"}</span>}
          {run.status === "paused" && <span>Paused - resume to continue where it stopped</span>}
          {run.error && <span className="text-negative">{run.error}</span>}
        </div>
        <p className="text-xs text-muted-foreground">Results below update as trades finish - you can leave this page and come back, the backtest keeps running.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Realized P&L" value={formatUsd(stats.realizedPnlUsd)} icon={Coins} tone={stats.realizedPnlUsd > 0 ? "positive" : stats.realizedPnlUsd < 0 ? "negative" : "default"} hint={stats.open > 0 ? `${formatUsd(stats.unrealizedUsd)} unrealized on ${stats.open} open` : undefined} />
        <StatTile label="Combined return" value={formatSignedPercent(stats.combinedPercent, 0)} icon={TrendingUp} tone={stats.combinedPercent > 0 ? "positive" : stats.combinedPercent < 0 ? "negative" : "default"} hint={stats.avgPercent != null ? `${formatSignedPercent(stats.avgPercent)} avg per trade` : undefined} />
        <StatTile label="Win rate" value={stats.winRatePercent != null ? `${stats.winRatePercent.toFixed(0)}%` : "—"} icon={Target} hint={`${stats.wins}W / ${stats.losses}L`} />
        <StatTile label="Closed trades" value={stats.closed.toLocaleString()} icon={CheckCheck} hint={stats.skipped > 0 ? `${stats.skipped.toLocaleString()} signals not traded` : undefined} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Clock className="size-3.5" /> Strategy followed (frozen when this backtest started)
        </span>
        <StrategyChips settings={run.settings} />
        {run.maxSignatures ? (
          <p className="text-xs text-muted-foreground">Addresses with more than {run.maxSignatures.toLocaleString()} signatures in the window are skipped.</p>
        ) : null}
      </div>

      <Tabs defaultValue="addresses" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="addresses" className="gap-1.5">
            <Users className="size-3.5" /> Addresses
          </TabsTrigger>
          <TabsTrigger value="daily" className="gap-1.5">
            <CalendarDays className="size-3.5" /> Daily
          </TabsTrigger>
          <TabsTrigger value="performance" className="gap-1.5">
            <TrendingUp className="size-3.5" /> Performance
          </TabsTrigger>
          <TabsTrigger value="trades" className="gap-1.5">
            <Coins className="size-3.5" /> Trades
          </TabsTrigger>
        </TabsList>

        <TabsContent value="addresses" className="flex flex-col gap-3">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={promote}>
                  {busy === "promote" ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                  Add to live Traders
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative" disabled={busy !== null} onClick={() => setBlacklistOpen(true)}>
                  <ShieldBan className="size-4" /> Blacklist
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative" disabled={busy !== null} onClick={() => setConfirm("remove-addresses")}>
                  <Trash2 className="size-4" /> Remove from backtest list
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          )}
          <RunTradersTable traders={traders} selected={selected} onSelectedChange={setSelected} onOpen={(address) => window.open(`/backtest/${runId}/${address}`, "_blank", "noopener,noreferrer")} />
        </TabsContent>

        <TabsContent value="daily">
          <DailyGrid runId={runId} traders={traders} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="performance" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Cumulative realized P&amp;L - all addresses</h3>
          <EquityChart runId={runId} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="trades">
          <PositionsTable runId={runId} refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>

      <BlacklistDialog
        open={blacklistOpen}
        onOpenChange={setBlacklistOpen}
        addresses={[...selected]}
        onDone={() => {
          setSelected(new Set());
          refresh();
        }}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "cancel" && "Cancel this backtest?"}
              {confirm === "delete" && "Delete this backtest?"}
              {confirm === "remove-addresses" && `Remove ${selected.size} address${selected.size === 1 ? "" : "es"} from the backtest list?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "cancel" && "It stops now. Everything simulated so far stays visible, but it can't be resumed."}
              {confirm === "delete" && "Its results are removed. The transaction history already collected is kept, so a new backtest on the same addresses starts faster."}
              {confirm === "remove-addresses" && "They leave the backtest list only. This backtest keeps their results, and live Traders are untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-negative text-negative-foreground hover:bg-negative/90"
              onClick={() => (confirm === "cancel" ? act("cancel") : confirm === "delete" ? remove() : removeAddresses())}
            >
              {confirm === "cancel" ? "Cancel backtest" : confirm === "delete" ? "Delete" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
