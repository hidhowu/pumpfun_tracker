"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, ChevronDown, ChevronLeft, CheckCheck, Coins, EllipsisVertical, Layers, ListPlus, Loader2, PauseCircle, PlayCircle, Pencil, RotateCcw, RefreshCcw, Settings2, Target, Trash2, TrendingUp, Users, Wallet, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import type { BacktestRunDetail } from "@/lib/backtest-types";
import { CombinedWalletPanel } from "./combined-wallet-panel";
import { DailyGrid } from "./daily-grid";
import { EquityChart } from "./equity-chart";
import { Panel } from "./parts";
import { PositionsTable } from "./positions-table";
import { RunTradersTable } from "./run-traders-table";
import { ViewsTab } from "./views-tab";
import { WorkerStatus } from "./worker-status";
import { BlacklistDialog } from "./blacklist-dialog";
import { EditRunDialog } from "./edit-run-dialog";
import { RestartRunDialog } from "./restart-run-dialog";
import { AddToRunDialog } from "./add-to-run-dialog";
import { PromoteDialog } from "./promote-dialog";
import { Pill, ProgressBar, RunStatusBadge, StrategyChips, formatDate, formatDuration, formatSignedPercent, waitingInQueue } from "./shared";

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
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [viewCount, setViewCount] = useState<number | null>(null);
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
      <div className="mx-auto flex w-full max-w-[1360px] flex-col items-start gap-3">
        <Link href="/backtest" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
          <ChevronLeft className="size-3.5" /> All backtests
        </Link>
        <p className="text-sm text-text-2">This backtest doesn&apos;t exist (it may have been deleted).</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full rounded-[20px]" />
        <Skeleton className="h-64 w-full rounded-[20px]" />
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
  const s = run.settings;
  const strategySummary = [
    "Frozen when this backtest started",
    `${formatUsd(s.tradeSizeUsd)} / trade`,
    s.stopLossPercent != null ? `stop-loss ${Math.abs(s.stopLossPercent)}%` : null,
    `${s.executionDelaySeconds} s delay`,
  ]
    .filter(Boolean)
    .join(" · ");
  const retrySkipped = (run.status === "completed" || run.status === "failed") && progress.addressesSkipped > 0;
  const retryFailed = settled && failedCount > 0;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <Link href="/backtest" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
        <ChevronLeft className="size-3.5" /> All backtests
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px]">{run.name}</h1>
            <RunStatusBadge status={run.status} control={run.control} queuePosition={progress.queuePosition} />
            {isCombined && <Pill tone="volt">Combined wallet</Pill>}
          </div>
          <span className="text-[13px] text-text-2">
            {run.days}-day window ({formatDate(run.windowStart)} – {formatDate(run.windowEnd)}) · following &quot;{run.profileName}&quot; · {run.addressCount.toLocaleString()} address
            {run.addressCount === 1 ? "" : "es"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPause && (
            <Button variant="outline" className="gap-1.5 max-md:h-11" disabled={busy !== null} onClick={() => act("pause")}>
              {busy === "pause" ? <Loader2 className="animate-spin" /> : <PauseCircle />} Pause
            </Button>
          )}
          {canResume && (
            <Button className="gap-1.5 max-md:h-11" disabled={busy !== null} onClick={() => act("resume")}>
              {busy === "resume" ? <Loader2 className="animate-spin" /> : <PlayCircle />} Resume
            </Button>
          )}
          {retrySkipped && (
            <Button variant="outline" className="gap-1.5 max-md:h-11" disabled={busy !== null} onClick={() => act("retry_skipped")}>
              <RotateCcw /> Retry {progress.addressesSkipped} skipped
            </Button>
          )}
          {retryFailed && (
            <Button variant="outline" className="gap-1.5 max-md:h-11" disabled={busy !== null} onClick={() => act("retry_failed")}>
              <RotateCcw /> Retry {failedCount} failed
            </Button>
          )}
          <Button variant="outline" className="gap-1.5 max-md:h-11" disabled={busy !== null} onClick={() => setAddOpen(true)}>
            <ListPlus /> Add addresses
          </Button>
          <Button variant="outline" className="gap-1.5 max-md:hidden" disabled={busy !== null} onClick={() => setEditOpen(true)}>
            <Pencil /> Edit
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="max-md:size-11 max-md:rounded-xl" aria-label="More actions">
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem className="min-h-10 gap-2.5 md:hidden" onSelect={() => setEditOpen(true)}>
                <Pencil className="size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-10 justify-between gap-2.5" disabled={!canRestart || busy !== null} onSelect={() => setRestartOpen(true)}>
                <span className="flex items-center gap-2.5">
                  <RefreshCcw className="size-4" /> Restart
                </span>
                {!canRestart ? <span className="text-xs text-text-3">pause first</span> : null}
              </DropdownMenuItem>
              {canCancel && (
                <DropdownMenuItem className="min-h-10 gap-2.5" disabled={busy !== null} onSelect={() => setConfirm("cancel")}>
                  <XCircle className="size-4" /> Cancel backtest
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" className="min-h-10 justify-between gap-2.5" disabled={running || busy !== null} onSelect={() => setConfirm("delete")}>
                <span className="flex items-center gap-2.5">
                  <Trash2 className="size-4" /> Delete
                </span>
                {running ? <span className="text-xs opacity-70">not while running</span> : null}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {running && <WorkerStatus showOnline detail="working on this backtest" />}

      <div className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4 md:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-[28px] leading-8 font-semibold tracking-[-0.02em] tabular-nums">{pct.toFixed(pct >= 99.95 || pct === 0 ? 0 : 1)}%</span>
          <span className="text-[13px] text-text-2">
            {progress.addressesDone.toLocaleString()} / {progress.addressesTotal.toLocaleString()} addresses done
            {failedCount > 0 ? ` · ${failedCount} failed` : ""}
            {progress.addressesSkipped > 0 ? ` · ${progress.addressesSkipped} skipped` : ""}
          </span>
        </div>
        <ProgressBar percent={pct} tone={run.status === "failed" ? "negative" : run.status === "completed" ? "positive" : run.status === "paused" || run.status === "cancelled" ? "warn" : "primary"} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-text-3">
          <span>Worked for {formatDuration(run.activeMs)}</span>
          {waitingInQueue(run.status, progress.queuePosition) ? (
            <span>
              Waiting in the queue — {progress.queuePosition === 1 ? "next in line" : `${progress.queuePosition - 1} backtests ahead of the next one`}. It starts by itself when the one running finishes.
            </span>
          ) : (
            running && <span>{progress.etaMs != null ? `About ${formatDuration(progress.etaMs)} left` : "Estimating time left…"}</span>
          )}
          {run.status === "paused" && <span>Paused — resume to continue where it stopped</span>}
          {run.status === "cancelled" && <span>Cancelled — resume to continue with the addresses that are not finished</span>}
          {run.error && <span className="text-negative">{run.error}</span>}
        </div>
        <span className="text-xs text-text-3">Results update as trades finish. You can leave this page.</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Realized P&L" value={formatUsd(stats.realizedPnlUsd)} icon={Coins} tone={stats.realizedPnlUsd > 0 ? "positive" : stats.realizedPnlUsd < 0 ? "negative" : "default"} hint={stats.open > 0 ? `${formatUsd(stats.unrealizedUsd)} unrealized on ${stats.open} open` : undefined} />
        <StatTile label="Combined return" value={formatSignedPercent(stats.combinedPercent, 0)} icon={TrendingUp} tone={stats.combinedPercent > 0 ? "positive" : stats.combinedPercent < 0 ? "negative" : "default"} hint={stats.avgPercent != null ? `${formatSignedPercent(stats.avgPercent)} avg per trade` : undefined} />
        <StatTile label="Win rate" value={stats.winRatePercent != null ? `${stats.winRatePercent.toFixed(0)}%` : "—"} icon={Target} hint={`${stats.wins}W / ${stats.losses}L`} />
        <StatTile label="Closed trades" value={stats.closed.toLocaleString()} icon={CheckCheck} hint={stats.skipped > 0 ? `${stats.skipped.toLocaleString()} signals not traded` : undefined} />
      </div>

      {/* Strategy followed: closed, with a one-line summary; opens to every setting. */}
      <section className="overflow-hidden rounded-[16px] border border-border bg-card">
        <button type="button" onClick={() => setStrategyOpen((v) => !v)} aria-expanded={strategyOpen} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-primary">
            <Settings2 className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[15px] font-semibold">Strategy followed</b>
            <span className="truncate text-xs text-text-3">{strategySummary}</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", strategyOpen && "rotate-180")} />
        </button>
        {strategyOpen && (
          <div className="flex flex-col gap-3 border-t border-border px-4 pt-3 pb-4">
            <StrategyChips settings={run.settings} />
            <div className="flex flex-col gap-1.5 text-xs text-text-2">
              <span>
                {run.collectMethod === "rpc"
                  ? "Trades are read from the chain over RPC (slow, reaches further back)."
                  : "Trades are read from pump.fun's user-trades API (fast, limited history)."}
              </span>
              {run.maxSignatures ? <span>Addresses with more than {run.maxSignatures.toLocaleString()} signatures in the window are skipped.</span> : null}
              {run.earlyStop && (run.earlyStop.lossDays > 0 || run.earlyStop.dayLossPercent > 0 || (run.earlyStop.negativeBalanceEvents ?? 0) > 0 || run.earlyStop.lossAtProgressPercent > 0) ? (
                <span>
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
                </span>
              ) : null}
              {run.daysAtOnce ? <span>Working on {run.daysAtOnce} day{run.daysAtOnce === 1 ? "" : "s"} of an address at a time.</span> : null}
              {run.addressParallelism ? <span>Working on {run.addressParallelism} address{run.addressParallelism === 1 ? "" : "es"} at a time.</span> : null}
            </div>
          </div>
        )}
      </section>

      <Tabs defaultValue={isCombined ? "wallet" : "addresses"} className="flex flex-col gap-4 md:gap-5">
        <TabsList variant="line" className="h-11 w-full justify-start gap-1 border-b border-border p-0">
          {(
            [
              ...(isCombined ? [{ value: "wallet", label: "Combined wallet", icon: Wallet, count: null as number | null }] : []),
              { value: "addresses", label: "Addresses", icon: Users, count: run.addressCount as number | null },
              { value: "daily", label: "Daily", icon: CalendarDays, count: null },
              { value: "performance", label: "Performance", icon: TrendingUp, count: null },
              { value: "trades", label: "Trades", icon: Coins, count: null },
              { value: "views", label: "Combined views", icon: Layers, count: viewCount },
            ] as { value: string; label: string; icon: typeof Wallet; count: number | null }[]
          ).map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="h-11 flex-none gap-2 rounded-none px-3.5 text-sm font-medium after:inset-x-2.5 group-data-horizontal/tabs:after:bottom-0 data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
            >
              <t.icon className="size-3.5 max-md:hidden" />
              {t.label}
              {t.count !== null ? <span className="rounded-full bg-surface-3 px-1.5 py-px text-[11px] font-normal text-text-2">{t.count.toLocaleString()}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {isCombined && (
          <TabsContent value="wallet">
            <CombinedWalletPanel runId={runId} refreshKey={refreshKey} />
          </TabsContent>
        )}

        <TabsContent value="addresses">
          <RunTradersTable
            runId={runId}
            active={running}
            selected={selected}
            onSelectedChange={setSelected}
            onOpen={(address) => window.open(`/backtest/${runId}/${address}`, "_blank", "noopener,noreferrer")}
            onPromote={() => setPromoteOpen(true)}
            onBlacklist={() => setBlacklistOpen(true)}
            onRemove={() => setConfirm("remove-addresses")}
            busy={busy !== null}
          />
        </TabsContent>

        <TabsContent value="daily">
          <DailyGrid runId={runId} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="performance">
          <Panel
            title="Cumulative realized P&L — all addresses"
            help="Re-prices this backtest's stored trades as other wallets (address group, trade amount, fees, balance) without simulating again."
          >
            <EquityChart runId={runId} refreshKey={refreshKey} />
          </Panel>
        </TabsContent>

        <TabsContent value="trades">
          <PositionsTable runId={runId} refreshKey={refreshKey} />
        </TabsContent>

        <TabsContent value="views">
          <ViewsTab runId={runId} suggestedBalanceUsd={run.combined?.startingBalanceUsd ?? run.settings.allocationUsd ?? 100} refreshKey={refreshKey} onCount={setViewCount} />
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
              className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
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
