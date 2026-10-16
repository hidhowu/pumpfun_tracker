"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, Layers, ListPlus, CheckCheck, Clock, Coins, Loader2, PauseCircle, PlayCircle, Pencil, RotateCcw, RefreshCcw, Target, Trash2, TrendingUp, ShieldBan, UserPlus, Users, Wallet, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { controlBacktestRun, deleteBacktestAddressesBatched, deleteBacktestRun, getBacktestRun } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestRunDetail } from "@/lib/backtest-types";
import { CombinedWalletPanel } from "./combined-wallet-panel";
import { DailyGrid } from "./daily-grid";
import { EquityChart } from "./equity-chart";
import { PositionsTable } from "./positions-table";
import { RunTradersTable } from "./run-traders-table";
import { ViewsTab } from "./views-tab";
import { WorkerStatus } from "./worker-status";
import { BlacklistDialog } from "./blacklist-dialog";
import { EditRunDialog } from "./edit-run-dialog";
import { RestartRunDialog } from "./restart-run-dialog";
import { AddToRunDialog } from "./add-to-run-dialog";
import { PromoteDialog } from "./promote-dialog";
import { ProgressBar, RunStatusBadge, StrategyChips, formatDate, formatDuration, formatSignedPercent, waitingInQueue } from "./shared";

const ACTIVE = new Set(["queued", "running"]);
// The chart, daily grid, trade list and combined wallet each read a lot of data, so while a backtest runs they refresh on this slower beat
// instead of with every progress poll.
const HEAVY_REFRESH_MS = 15_000;

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
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const lastStatus = useRef<string | null>(null);
  const lastHeavy = useRef(0);
  const forceHeavy = useRef(false); // something changed the results (restart, edit, remove): the heavy panels re-read at the next poll

  const refresh = useCallback(async () => {
    try {
      const d = await getBacktestRun(runId);
      setDetail(d);
      // The heavy panels re-read when the status changed (the poll that notices a run just finished is the last one they need), and
      // every HEAVY_REFRESH_MS while it is being worked on.
      const working = ACTIVE.has(d.run.status) || d.run.control !== "run";
      if (forceHeavy.current || lastStatus.current !== d.run.status || (working && Date.now() - lastHeavy.current >= HEAVY_REFRESH_MS)) {
        forceHeavy.current = false;
        lastHeavy.current = Date.now();
        setRefreshKey((k) => k + 1);
      }
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

  async function act(action: "pause" | "resume" | "cancel" | "retry_failed" | "retry_skipped") {
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

  async function removeAddresses() {
    setBusy("remove-addresses");
    try {
      const all = [...selected];
      const { deletedCount } = await deleteBacktestAddressesBatched(all, (done, total) =>
        toast.loading(`Removing ${done.toLocaleString()} / ${total.toLocaleString()}…`, { id: "remove-addresses" })
      );
      toast.dismiss("remove-addresses");
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

  const { run, progress, stats } = detail;
  const running = ACTIVE.has(run.status);
  const canPause = running && run.control === "run";
  // A cancelled backtest keeps everything it finished and the addresses it had not reached, so it can be resumed just like a paused one.
  const canResume = run.status === "paused" || run.status === "cancelled";
  const canCancel = (running && run.control === "run") || run.status === "paused";
  // Restarting throws the results away and starts from the first address; not while the worker is working on it (pause first).
  const canRestart = !(running && run.control === "run");
  const failedCount = progress.addressesFailed;
  const settled = !running && run.status !== "paused";
  const pct = progress.percent;
  const isCombined = run.mode === "combined" && !!run.combined;

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
            <RunStatusBadge status={run.status} control={run.control} queuePosition={progress.queuePosition} />
            {isCombined && (
              <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 font-normal text-primary">
                <Wallet className="size-3" /> Combined wallet
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {run.days}-day window ({formatDate(run.windowStart)} – {formatDate(run.windowEnd)}) · following &quot;{run.profileName}&quot; · {run.addressCount.toLocaleString()} address
            {run.addressCount === 1 ? "" : "es"}
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
          {(run.status === "completed" || run.status === "failed") && progress.addressesSkipped > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => act("retry_skipped")}>
              <RotateCcw className="size-4" /> Retry {progress.addressesSkipped} skipped
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => setAddOpen(true)}>
            <ListPlus className="size-4" /> Add addresses
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
          {canRestart && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy !== null}
              onClick={() => setRestartOpen(true)}
            >
              <RefreshCcw className="size-4" /> Restart
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
            {progress.addressesDone.toLocaleString()}/{progress.addressesTotal.toLocaleString()} addresses done{failedCount > 0 ? ` · ${failedCount} failed` : ""}{progress.addressesSkipped > 0 ? ` · ${progress.addressesSkipped} skipped` : ""}
          </span>
        </div>
        <ProgressBar percent={pct} tone={run.status === "failed" ? "negative" : run.status === "completed" ? "positive" : "primary"} className="h-2" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Worked for {formatDuration(run.activeMs)}</span>
          {waitingInQueue(run.status, progress.queuePosition) ? (
            <span>
              Waiting in the queue - {progress.queuePosition === 1 ? "next in line" : `${progress.queuePosition - 1} backtests ahead of the next one`}. It starts by itself when the one running finishes.
            </span>
          ) : (
            running && <span>{progress.etaMs != null ? `About ${formatDuration(progress.etaMs)} left` : "Estimating time left…"}</span>
          )}
          {run.status === "paused" && <span>Paused - resume to continue where it stopped</span>}
          {run.status === "cancelled" && <span>Cancelled - resume to continue with the addresses that are not finished</span>}
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
        <p className="text-xs text-muted-foreground">
          {run.collectMethod === "rpc"
            ? "Trades are read from the chain over RPC (slow, reaches further back)."
            : "Trades are read from pump.fun's user-trades API (fast, limited history)."}
        </p>
        {run.maxSignatures ? (
          <p className="text-xs text-muted-foreground">Addresses with more than {run.maxSignatures.toLocaleString()} signatures in the window are skipped.</p>
        ) : null}
        {run.earlyStop && (run.earlyStop.lossDays > 0 || run.earlyStop.dayLossPercent > 0 || (run.earlyStop.negativeBalanceEvents ?? 0) > 0 || run.earlyStop.lossAtProgressPercent > 0) ? (
          <p className="text-xs text-muted-foreground">
            A trader is dropped as a loss trader{" "}
            {[
              run.earlyStop.lossDays > 0 ? `after ${run.earlyStop.lossDays} losing day${run.earlyStop.lossDays === 1 ? "" : "s"}` : null,
              run.earlyStop.dayLossPercent > 0 ? `when one day loses ${run.earlyStop.dayLossPercent}% or more` : null,
              (run.earlyStop.negativeBalanceEvents ?? 0) > 0 ? `once its balance has gone negative ${run.earlyStop.negativeBalanceEvents} times` : null,
              run.earlyStop.lossAtProgressPercent > 0 ? `if still in loss after ${run.earlyStop.lossAtProgressPercent}% of its tokens` : null,
            ]
              .filter(Boolean)
              .join(", or ")}
            {progress.addressesStoppedEarly ? ` (${progress.addressesStoppedEarly} dropped so far)` : ""}.
          </p>
        ) : null}
        {run.daysAtOnce ? <p className="text-xs text-muted-foreground">Working on {run.daysAtOnce} day{run.daysAtOnce === 1 ? "" : "s"} of an address at a time.</p> : null}
        {run.addressParallelism ? <p className="text-xs text-muted-foreground">Working on {run.addressParallelism} address{run.addressParallelism === 1 ? "" : "es"} at a time.</p> : null}
      </div>

      <Tabs defaultValue={isCombined ? "wallet" : "addresses"} className="flex flex-col gap-4">
        <TabsList>
          {isCombined && (
            <TabsTrigger value="wallet" className="gap-1.5">
              <Wallet className="size-3.5" /> Combined wallet
            </TabsTrigger>
          )}
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
          <TabsTrigger value="views" className="gap-1.5">
            <Layers className="size-3.5" /> Combined views
          </TabsTrigger>
        </TabsList>

        {isCombined && (
          <TabsContent value="wallet">
            <CombinedWalletPanel runId={runId} refreshKey={refreshKey} />
          </TabsContent>
        )}

        <TabsContent value="addresses" className="flex flex-col gap-3">
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium">{selected.size} selected</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" className="gap-1.5" disabled={busy !== null} onClick={() => setPromoteOpen(true)}>
                  <UserPlus className="size-4" />
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
          <RunTradersTable runId={runId} active={running} selected={selected} onSelectedChange={setSelected} onOpen={(address) => window.open(`/backtest/${runId}/${address}`, "_blank", "noopener,noreferrer")} />
        </TabsContent>

        <TabsContent value="daily">
          <DailyGrid runId={runId} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="performance" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Cumulative realized P&amp;L - all addresses</h3>
          <EquityChart runId={runId} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="trades">
          <PositionsTable runId={runId} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="views">
          <ViewsTab runId={runId} suggestedBalanceUsd={run.combined?.startingBalanceUsd ?? run.settings.allocationUsd ?? 100} refreshKey={refreshKey} />
        </TabsContent>
      </Tabs>

      <EditRunDialog
        run={run}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          forceHeavy.current = true;
          refresh();
        }}
      />

      <AddToRunDialog
        run={run}
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={() => {
          forceHeavy.current = true;
          refresh();
        }}
      />

      <PromoteDialog runId={runId} addresses={[...selected]} open={promoteOpen} onOpenChange={setPromoteOpen} onDone={() => {}} />

      {restartOpen && (
        <RestartRunDialog
          run={run}
          open
          onOpenChange={setRestartOpen}
          onRestarted={() => {
            forceHeavy.current = true;
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      <BlacklistDialog
        open={blacklistOpen}
        onOpenChange={setBlacklistOpen}
        addresses={[...selected]}
        onDone={() => {
          setSelected(new Set());
          forceHeavy.current = true;
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
              {confirm === "cancel" && "It stops now. Everything finished so far stays visible, and you can resume it later to carry on with the addresses that are not done."}
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
