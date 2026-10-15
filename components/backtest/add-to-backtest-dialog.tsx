"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addAddressesToRunBatched, listBacktestRuns } from "@/lib/backtest-api";
import type { BacktestRunSummary } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { BatchProgress, type BatchState } from "./batch-progress";
import { RunStatusBadge } from "./shared";

/**
 * Adds the selected addresses to a backtest that already exists - running, queued, paused or finished - instead of starting a new one with the same
 * settings. Sent in batches, so a selection of any size is fine.
 */
export function AddToBacktestDialog({ addresses, open, onOpenChange, onDone }: { addresses: string[]; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [runs, setRuns] = useState<BacktestRunSummary[] | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [state, setState] = useState<BatchState | null>(null);
  const working = state !== null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listBacktestRuns()
      .then(({ runs }) => !cancelled && setRuns(runs))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load the backtests"));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chosen = runs?.find((r) => r._id === choice) ?? null;

  async function add() {
    if (!chosen) return;
    setState({ done: 0, total: addresses.length, lines: [] });
    try {
      const t = await addAddressesToRunBatched(chosen._id, addresses, (done, total) => setState({ done, total, lines: [] }));
      const finished = chosen.status === "completed" || chosen.status === "failed";
      const parts = [`${t.added.toLocaleString()} added to "${chosen.name}"`];
      if (t.alreadyInRun) parts.push(`${t.alreadyInRun.toLocaleString()} were already in it`);
      toast.success(parts.join(", ") + (t.added > 0 && finished ? ". It is paused with the new addresses waiting - press Resume to process them." : "."));
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add the addresses");
      onDone(); // some batches may have gone through
    } finally {
      setState(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => working && e.preventDefault()} onEscapeKeyDown={(e) => working && e.preventDefault()}>
        {working && state ? (
          <BatchProgress title="Adding to the backtest…" note="Sent in batches so the page and the server stay responsive. Closing is disabled until it finishes." state={state} stopping={false} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Add {addresses.length.toLocaleString()} address{addresses.length === 1 ? "" : "es"} to a backtest
              </DialogTitle>
              <DialogDescription>
                Pick the backtest to grow. If it is running the new addresses are picked up at once; if it has finished it is paused with them waiting, and Resume processes only
                the new ones. Addresses it already has are skipped.
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {runs === null ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
              ) : runs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">There are no backtests yet.</p>
              ) : (
                runs.map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => setChoice(r._id)}
                    className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors", choice === r._id ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40")}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {r.addressCount.toLocaleString()} address{r.addressCount === 1 ? "" : "es"} · {r.days}d · {r.profileName}
                      </span>
                    </span>
                    <RunStatusBadge status={r.status} control={r.control} queuePosition={r.progress.queuePosition} />
                  </button>
                ))
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button className="gap-1.5" disabled={!chosen || addresses.length === 0} onClick={add}>
                {runs === null ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add to backtest
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
