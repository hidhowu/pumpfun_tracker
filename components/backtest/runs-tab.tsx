"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, FlaskConical, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { deleteBacktestRun, listBacktestRuns } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestRunSummary } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { ProgressBar, RunStatusBadge, formatDate, formatDuration, formatSignedPercent, pnlTone } from "./shared";

const ACTIVE = new Set(["queued", "running"]);

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

/** Every backtest, newest first, with live progress while any of them is running. */
export function RunsTab() {
  const [runs, setRuns] = useState<BacktestRunSummary[] | null>(null);
  const [toDelete, setToDelete] = useState<BacktestRunSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { runs } = await listBacktestRuns();
      setRuns(runs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load backtests");
    }
  }, []);

  const anyActive = runs?.some((r) => ACTIVE.has(r.status)) ?? false;

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, anyActive ? 4000 : 20000);
    return () => clearInterval(interval);
  }, [refresh, anyActive]);

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
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-4 text-center">
        <FlaskConical className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No backtests yet. Add addresses, select some and press &quot;Start backtest&quot;.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        {runs.map((run) => {
          const active = ACTIVE.has(run.status);
          const s = run.stats;
          return (
            <Card key={run._id} className="border-border/60 transition-colors hover:border-primary/50">
              <CardContent className="flex flex-col gap-4 px-5 py-4">
                <div className="flex items-start gap-2">
                  <Link href={`/backtest/${run._id}`} className="group flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-1.5 font-semibold tracking-tight">
                      <span className="truncate">{run.name}</span>
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {run.days}d · {formatDate(run.windowStart)} – {formatDate(run.windowEnd)} · follows &quot;{run.profileName}&quot; · {run.addresses.length} address
                      {run.addresses.length === 1 ? "" : "es"}
                    </span>
                  </Link>
                  <RunStatusBadge status={run.status} control={run.control} />
                  {!active && (
                    <Button variant="ghost" size="sm" className="-mr-2 text-muted-foreground hover:text-negative" onClick={() => setToDelete(run)} aria-label="Delete backtest">
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <ProgressBar percent={run.progress.percent} tone={run.status === "failed" ? "negative" : run.status === "completed" ? "positive" : "primary"} />
                  <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
                    <span>
                      {run.progress.percent.toFixed(run.progress.percent >= 99.95 || run.progress.percent === 0 ? 0 : 1)}% · {run.progress.addressesDone}/{run.progress.addressesTotal} addresses done
                      {run.progress.addressesFailed > 0 ? ` · ${run.progress.addressesFailed} failed` : ""}
                    </span>
                    {active && <span>{run.progress.etaMs != null ? `about ${formatDuration(run.progress.etaMs)} left` : "estimating time left…"}</span>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Realized P&L" value={formatUsd(s.realizedPnlUsd)} className={pnlTone(s.realizedPnlUsd)} />
                  <Stat label="Combined" value={formatSignedPercent(s.combinedPercent, 0)} className={pnlTone(s.combinedPercent)} />
                  <Stat label="Win rate" value={s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"} />
                  <Stat label="Closed trades" value={s.closed.toLocaleString()} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{toDelete?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Its results are removed. The transaction history already collected for the addresses is kept, so a new backtest on them starts faster.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-negative text-negative-foreground hover:bg-negative/90" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
