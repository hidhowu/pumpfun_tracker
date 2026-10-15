"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, GitMerge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mergeBacktests, previewMerge } from "@/lib/backtest-api";
import type { BacktestRunSummary, MergePreview } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { BatchProgress, type BatchState } from "./batch-progress";
import { RunStatusBadge } from "./shared";

type Props = { runs: BacktestRunSummary[]; open: boolean; onOpenChange: (open: boolean) => void; onMerged: () => void };

/**
 * Merges backtests that are really one test: pick the backtest to keep, tick the ones to fold into it, review how their settings differ, and go.
 * The other backtests' addresses (and results) move into the one you keep; the others are removed. Addresses that are in more than one stay as they are in the one
 * you keep. Where a backtest was run with different strategy settings its addresses are simulated again with yours, unless you choose to keep its results.
 */
export function MergeRunsDialog({ runs, open, onOpenChange, onMerged }: Props) {
  const [target, setTarget] = useState("");
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [keepResults, setKeepResults] = useState<Set<string>>(new Set()); // sources whose results are kept even though their settings differ
  const [checking, setChecking] = useState(false);
  const [state, setState] = useState<BatchState | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const working = state !== null;

  function toggleSource(id: string) {
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreview(null);
  }

  async function check() {
    setChecking(true);
    try {
      setPreview(await previewMerge(target, [...sources]));
      setKeepResults(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to check the backtests");
    } finally {
      setChecking(false);
    }
  }

  const blocked = preview?.sources.some((s) => s.blocked) ?? false;
  const rerunCount = preview ? preview.sources.filter((s) => !s.sameResults && !keepResults.has(s._id)).reduce((n, s) => n + s.addressCount, 0) : 0;
  const totalAddresses = preview ? preview.sources.reduce((n, s) => n + s.addressCount, 0) : 0;

  async function merge() {
    if (!preview) return;
    stopRequested.current = false;
    setStopping(false);
    setState({ done: 0, total: totalAddresses, lines: [] });
    try {
      const result = await mergeBacktests(
        preview.target._id,
        preview.sources.map((s) => ({ _id: s._id, addressCount: s.addressCount, rerun: !s.sameResults && !keepResults.has(s._id) })),
        (done, total) => setState({ done, total, lines: [] }),
        () => stopRequested.current
      );
      const removed = result.removed.length;
      if (result.stopped) toast.message(`Stopped. ${removed} backtest${removed === 1 ? "" : "s"} fully merged; merge the rest again to continue - what moved stays moved.`);
      else
        toast.success(
          `Merged ${removed} backtest${removed === 1 ? "" : "s"} into "${preview.target.name}": ${result.moved.toLocaleString()} addresses moved${result.duplicates ? `, ${result.duplicates.toLocaleString()} duplicates dropped` : ""}.` +
            (rerunCount > 0 ? " Some addresses are waiting to be simulated again - press Resume on it if it is paused." : "")
        );
      onMerged();
      if (!result.stopped) {
        onOpenChange(false);
        setPreview(null);
        setSources(new Set());
      }
    } catch (e) {
      toast.error(`${e instanceof Error ? e.message : "Merge failed"}. Nothing is lost - run the merge again to continue where it stopped.`);
      onMerged();
    } finally {
      setState(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <DialogContent className="flex max-h-[88vh] flex-col overflow-y-auto sm:max-w-2xl" onInteractOutside={(e) => working && e.preventDefault()} onEscapeKeyDown={(e) => working && e.preventDefault()}>
        {working && state ? (
          <BatchProgress
            title="Merging backtests…"
            note="Moving the addresses and their results a page at a time. Closing is disabled until it finishes or you stop it; if it is interrupted, run the merge again - what already moved stays moved."
            state={state}
            stopping={stopping}
            onStop={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Merge backtests</DialogTitle>
              <DialogDescription>
                Fold several backtests into one. Pick the one to <span className="font-medium text-foreground">keep</span>, then tick the ones to merge into it - their addresses and
                results move over and they are removed. An address that is in more than one stays as it is in the one you keep.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">1. Keep this one</span>
              <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
                {runs.map((r) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => {
                      setTarget(r._id);
                      setSources((prev) => {
                        const next = new Set(prev);
                        next.delete(r._id);
                        return next;
                      });
                      setPreview(null);
                    }}
                    className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-left transition-colors", target === r._id ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40")}
                  >
                    <span className="min-w-0 truncate text-sm">
                      {r.name} <span className="text-xs text-muted-foreground">· {r.addressCount.toLocaleString()} addresses · {r.days}d</span>
                    </span>
                    <RunStatusBadge status={r.status} control={r.control} queuePosition={r.progress.queuePosition} />
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">2. Merge these into it</span>
              <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
                {runs.filter((r) => r._id !== target).map((r) => (
                  <label key={r._id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 px-3 py-1.5 hover:bg-muted/40">
                    <input type="checkbox" className="size-4 accent-primary" checked={sources.has(r._id)} onChange={() => toggleSource(r._id)} disabled={!target} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {r.name} <span className="text-xs text-muted-foreground">· {r.addressCount.toLocaleString()} addresses · {r.days}d</span>
                    </span>
                    <RunStatusBadge status={r.status} control={r.control} queuePosition={r.progress.queuePosition} />
                  </label>
                ))}
                {!target && <p className="px-1 text-xs text-muted-foreground">Choose the backtest to keep first.</p>}
              </div>
            </div>

            {preview && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">3. Check</span>
                {preview.sources.map((s) => (
                  <div key={s._id} className={cn("flex flex-col gap-1.5 rounded-lg border px-3 py-2", s.blocked ? "border-negative/40" : s.sameResults ? "border-positive/30" : "border-amber-500/40")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        {s.blocked ? <AlertTriangle className="size-4 shrink-0 text-negative" /> : s.sameResults ? <CheckCircle2 className="size-4 shrink-0 text-positive" /> : <AlertTriangle className="size-4 shrink-0 text-amber-500" />}
                        <span className="truncate">{s.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{s.addressCount.toLocaleString()} addresses</span>
                    </div>
                    {s.blocked ? (
                      <p className="text-xs text-negative">{s.blocked}.</p>
                    ) : s.sameResults ? (
                      <p className="text-xs text-muted-foreground">Same simulation settings - its results are kept as they are.</p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground">
                          Different settings, so its results are not comparable:{" "}
                          {s.differences.map((d) => `${d.label} (${d.source} here, ${d.target} in "${preview.target.name}")`).join("; ")}.
                        </p>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={keepResults.has(s._id)}
                            onChange={() =>
                              setKeepResults((prev) => {
                                const next = new Set(prev);
                                if (next.has(s._id)) next.delete(s._id);
                                else next.add(s._id);
                                return next;
                              })
                            }
                          />
                          Keep its existing results anyway (otherwise its addresses are simulated again with the settings of &quot;{preview.target.name}&quot;)
                        </label>
                      </>
                    )}
                    {s.otherDifferences.length > 0 && !s.blocked && (
                      <p className="text-[11px] text-muted-foreground">
                        Also differs (does not change any result; the settings of &quot;{preview.target.name}&quot; apply from now on): {s.otherDifferences.map((d) => d.label).join(", ")}.
                      </p>
                    )}
                    {s.windowOffsetHours >= 6 && !s.blocked && (
                      <p className="text-[11px] text-muted-foreground">Its period ends about {s.windowOffsetHours} hours {s.windowOffsetHours >= 24 ? `(${Math.round(s.windowOffsetHours / 24)} days) ` : ""}away from the kept one&apos;s. Results that are kept stay on the period they were collected for.</p>
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {totalAddresses.toLocaleString()} addresses will move; {preview.sources.length} backtest{preview.sources.length === 1 ? "" : "s"} will be removed.
                  {rerunCount > 0 ? ` ${rerunCount.toLocaleString()} will be simulated again (already-collected data is reused, so that is much faster than the first time).` : ""}
                  {preview.target.status === "completed" || preview.target.status === "failed" ? ' If the kept backtest has work waiting afterwards it is paused: press Resume to process just that.' : ""}
                </p>
              </div>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              {!preview ? (
                <Button className="gap-1.5" disabled={!target || sources.size === 0 || checking} onClick={check}>
                  {checking ? <Loader2 className="size-4 animate-spin" /> : <GitMerge className="size-4" />}
                  Check the merge
                </Button>
              ) : (
                <Button className="gap-1.5" disabled={blocked} onClick={merge}>
                  <GitMerge className="size-4" /> Merge {preview.sources.length} backtest{preview.sources.length === 1 ? "" : "s"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
