"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { EllipsisVertical, FlaskConical, GitMerge, Loader2, Pencil, PlayCircle, RefreshCcw, Search, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { controlBacktestRun, deleteBacktestRun, listBacktestRuns } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestRunSummary, BacktestStatus } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { EditRunDialog } from "./edit-run-dialog";
import { RestartRunDialog } from "./restart-run-dialog";
import { MergeRunsDialog } from "./merge-runs-dialog";
import { Pill, ProgressBar, RunStatusBadge, formatDate, formatDuration, formatSignedPercent, pnlTone, waitingInQueue } from "./shared";

const ACTIVE = new Set(["queued", "running"]);

type StatusFilter = "all" | "running" | "queued" | "paused" | "completed" | "failed";
const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];
// "Paused" also holds cancelled backtests: both can be resumed.
const matchesFilter = (status: BacktestStatus, filter: StatusFilter) => filter === "all" || status === filter || (filter === "paused" && status === "cancelled");

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-xs text-text-3">{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

/** Every backtest, newest first, with live progress while any of them is running. */
export function RunsTab({ onCount, onGoToAddresses }: { onCount?: (count: number) => void; onGoToAddresses?: () => void }) {
  const [runs, setRuns] = useState<BacktestRunSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [toDelete, setToDelete] = useState<BacktestRunSummary | null>(null);
  const [toEdit, setToEdit] = useState<BacktestRunSummary | null>(null);
  const [toRestart, setToRestart] = useState<BacktestRunSummary | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState(""); // the search once typing has paused
  const [filter, setFilter] = useState<StatusFilter>("all");
  const latest = useRef(0);

  // Searching waits for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async () => {
    const call = ++latest.current;
    try {
      const { runs } = await listBacktestRuns(appliedSearch);
      if (call === latest.current) {
        setRuns(runs); // an older answer must not replace a newer search
        setLoadError(false);
        if (!appliedSearch) onCount?.(runs.length);
      }
    } catch (e) {
      setLoadError(true);
      toast.error(e instanceof Error ? e.message : "Failed to load backtests");
    }
  }, [appliedSearch, onCount]);

  const anyActive = runs?.some((r) => ACTIVE.has(r.status)) ?? false;

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, anyActive ? 4000 : 20000);
    return () => clearInterval(interval);
  }, [refresh, anyActive]);

  const shown = useMemo(() => (runs ?? []).filter((r) => matchesFilter(r.status, filter)), [runs, filter]);

  async function resume(run: BacktestRunSummary) {
    setResuming(run._id);
    try {
      await controlBacktestRun(run._id, "resume");
      toast.success(`"${run.name}" resumed`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resume");
    } finally {
      setResuming(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await deleteBacktestRun(toDelete._id);
      toast.success("Backtest deleted");
      setToDelete(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
      setToDelete(null);
    }
  }

  if (runs === null) {
    return loadError ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
        <TriangleAlert className="size-4 shrink-0 text-destructive" />
        <span className="min-w-0 flex-1">
          <b>Couldn&apos;t load the backtests.</b> Try again in a moment.
        </span>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[200px] w-full rounded-[20px]" />
        ))}
      </div>
    );
  }

  if (runs.length === 0 && !appliedSearch && !search) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center">
        <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
          <FlaskConical className="size-6" />
        </span>
        <b className="text-[15px] font-semibold">No backtests yet</b>
        <span className="max-w-[420px] text-[13px] text-text-2">Add addresses, select some and press &ldquo;Start backtest&rdquo;.</span>
        {onGoToAddresses ? <Button onClick={onGoToAddresses}>Go to Addresses</Button> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-12 min-w-0 basis-full items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:basis-[320px] md:rounded-[10px]">
          <Search className="size-4 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find backtests containing an address"
            aria-label="Find backtests containing an address"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 md:mx-0 md:w-auto md:overflow-visible md:px-0" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <Chip key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="hidden flex-1 md:block" />
        {runs.length >= 2 && (
          <Button variant="outline" className="gap-1.5 max-md:h-11 max-md:w-full" onClick={() => setMergeOpen(true)}>
            <GitMerge className="size-4" /> Merge backtests
          </Button>
        )}
      </div>

      {runs.length === 0 ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center">
          <b className="text-sm font-semibold">No backtest contains that address.</b>
          <span className="text-xs text-text-3">Check the spelling or paste the full address.</span>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center">
          <b className="text-sm font-semibold">No {FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} backtests.</b>
          <Button variant="outline" size="sm" onClick={() => setFilter("all")}>
            Show all
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          {shown.map((run) => {
            const active = ACTIVE.has(run.status);
            const s = run.stats;
            const canRestart = !(active && run.control === "run");
            const canResume = run.status === "paused" || run.status === "cancelled";
            return (
              <article key={run._id} className="flex min-w-0 flex-col gap-4 rounded-[20px] border border-border bg-card p-4 transition-colors hover:border-line-3 md:p-5">
                <div className="flex items-start gap-3">
                  <Link href={`/backtest/${run._id}`} className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <b className="max-w-full truncate text-[15px] font-semibold">{run.name}</b>
                      {run.mode === "combined" && <Pill tone="volt">Combined</Pill>}
                      <RunStatusBadge status={run.status} control={run.control} queuePosition={run.progress.queuePosition} />
                    </span>
                    <span className="text-xs text-text-3">
                      {run.days}d · {formatDate(run.windowStart)} – {formatDate(run.windowEnd)} · follows &quot;{run.profileName}&quot; · {run.addressCount.toLocaleString()} address{run.addressCount === 1 ? "" : "es"}
                    </span>
                  </Link>
                  {/* Wide screens: the actions as buttons. */}
                  <div className="flex shrink-0 items-center gap-0.5 max-md:hidden">
                    {canResume && (
                      <Button variant="outline" size="sm" className="mr-1 gap-1" disabled={resuming === run._id} onClick={() => resume(run)}>
                        {resuming === run._id ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                        Resume
                      </Button>
                    )}
                    {canRestart && (
                      <Button variant="ghost" size="icon-sm" className="text-text-2" onClick={() => setToRestart(run)} aria-label="Restart backtest" title="Restart from the first address">
                        <RefreshCcw />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon-sm" className="text-text-2" onClick={() => setToEdit(run)} aria-label="Edit backtest">
                      <Pencil />
                    </Button>
                    {!active && (
                      <Button variant="ghost" size="icon-sm" className="text-text-2 hover:text-negative" onClick={() => setToDelete(run)} aria-label="Delete backtest">
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <ProgressBar percent={run.progress.percent} tone={run.status === "failed" ? "negative" : run.status === "completed" ? "positive" : run.status === "paused" || run.status === "cancelled" ? "warn" : "primary"} />
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-text-3">
                    <span>
                      {run.progress.percent.toFixed(run.progress.percent >= 99.95 || run.progress.percent === 0 ? 0 : 1)}% · {run.progress.addressesDone.toLocaleString()} / {run.progress.addressesTotal.toLocaleString()} addresses done
                      {run.progress.addressesFailed > 0 ? ` · ${run.progress.addressesFailed} failed` : ""}
                      {run.progress.addressesSkipped > 0 ? ` · ${run.progress.addressesSkipped} skipped` : ""}
                    </span>
                    {waitingInQueue(run.status, run.progress.queuePosition) ? (
                      <span>{run.progress.queuePosition === 1 ? "Next in line" : `${run.progress.queuePosition - 1} backtests before it in line`} · starts by itself</span>
                    ) : (
                      active && <span>{run.progress.etaMs != null ? `about ${formatDuration(run.progress.etaMs)} left` : "estimating time left…"}</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
                  <Stat label="Realized P&L" value={s.closed > 0 || s.realizedPnlUsd !== 0 ? formatUsd(s.realizedPnlUsd) : "—"} className={pnlTone(s.realizedPnlUsd)} />
                  <Stat label="Combined" value={s.closed > 0 ? formatSignedPercent(s.combinedPercent, 0) : "—"} className={pnlTone(s.combinedPercent)} />
                  <Stat label="Win rate" value={s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"} />
                  <Stat label="Closed trades" value={s.closed.toLocaleString()} />
                </div>

                {/* Phone: the main action as a full-width button and the rest in a menu. */}
                <div className="flex items-center gap-2 md:hidden">
                  {canResume ? (
                    <Button className="h-11 flex-1 gap-1.5" disabled={resuming === run._id} onClick={() => resume(run)}>
                      {resuming === run._id ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                      Resume
                    </Button>
                  ) : canRestart ? (
                    <Button variant="outline" className="h-11 flex-1 gap-1.5" onClick={() => setToRestart(run)}>
                      <RefreshCcw /> Restart
                    </Button>
                  ) : (
                    <Button variant="outline" className="h-11 flex-1" asChild>
                      <Link href={`/backtest/${run._id}`}>Open</Link>
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-lg" aria-label="More actions">
                        <EllipsisVertical />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {canResume && canRestart && (
                        <DropdownMenuItem className="min-h-10 gap-2.5" onSelect={() => setToRestart(run)}>
                          <RefreshCcw className="size-4" /> Restart
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="min-h-10 gap-2.5" onSelect={() => setToEdit(run)}>
                        <Pencil className="size-4" /> Edit
                      </DropdownMenuItem>
                      {!active && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" className="min-h-10 gap-2.5" onSelect={() => setToDelete(run)}>
                            <Trash2 className="size-4" /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-text-3 max-md:hidden">The list refreshes every 4 s while anything is running or queued, every 20 s otherwise.</p>

      <MergeRunsDialog runs={runs} open={mergeOpen} onOpenChange={setMergeOpen} onMerged={refresh} />

      {toRestart && <RestartRunDialog run={toRestart} open onOpenChange={(open) => !open && setToRestart(null)} onRestarted={refresh} />}

      {toEdit && <EditRunDialog run={toEdit} open onOpenChange={(open) => !open && setToEdit(null)} onSaved={refresh} />}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{toDelete?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Its results are removed. Collected history is kept, so a rerun is faster.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
