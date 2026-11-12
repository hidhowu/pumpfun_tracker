"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { addAddressesToRunBatched, listBacktestRuns } from "@/lib/backtest-api";
import type { BacktestRunSummary } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { BatchProgress, type BatchState } from "./batch-progress";
import { DialogHead } from "./dialog-parts";
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
      <DialogContent className="sm:max-w-[520px]" onInteractOutside={(e) => working && e.preventDefault()} onEscapeKeyDown={(e) => working && e.preventDefault()}>
        {working && state ? (
          <BatchProgress title="Adding to the backtest…" note="Sent in batches so the page and the server stay responsive." state={state} stopping={false} />
        ) : (
          <>
            <DialogHead
              icon={<FlaskConical className="size-5" />}
              title={`Add ${addresses.length.toLocaleString()} address${addresses.length === 1 ? "" : "es"} to a backtest`}
              help="Pick the backtest to grow. A running one picks the new addresses up at once; a finished one is paused with them waiting, and Resume processes only them. Addresses it already has are skipped."
              description="Choose the backtest to add the selected addresses to."
            />
            <div role="radiogroup" aria-label="Backtest to add to" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
              {runs === null ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-[14px]" />)
              ) : runs.length === 0 ? (
                <p className="rounded-[14px] border border-dashed border-line-3 px-4 py-8 text-center text-sm text-text-2">There are no backtests yet.</p>
              ) : (
                runs.map((r) => {
                  const on = choice === r._id;
                  return (
                    <button
                      key={r._id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setChoice(r._id)}
                      className={cn(
                        "flex min-h-[56px] items-center gap-3 rounded-[14px] border bg-surface-2 px-3.5 py-2 text-left transition-colors",
                        on ? "border-volt-line bg-volt-soft" : "border-border hover:border-line-2"
                      )}
                    >
                      <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-full border", on ? "border-primary" : "border-line-3")}>{on && <span className="size-2 rounded-full bg-primary" />}</span>
                      <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                        <b className="truncate text-[13.5px] font-semibold">{r.name}</b>
                        <span className="truncate text-xs text-text-3">
                          {r.addressCount.toLocaleString()} address{r.addressCount === 1 ? "" : "es"} · {r.days}d · {r.profileName}
                        </span>
                      </span>
                      <RunStatusBadge status={r.status} control={r.control} queuePosition={r.progress.queuePosition} />
                    </button>
                  );
                })
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button className="gap-1.5" disabled={!chosen || addresses.length === 0} onClick={add}>
                {runs === null ? <Loader2 className="animate-spin" /> : <Plus />}
                Add to backtest
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
