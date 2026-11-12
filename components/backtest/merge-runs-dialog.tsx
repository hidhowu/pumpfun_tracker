"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { CircleCheck, GitMerge, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { mergeBacktests, previewMerge } from "@/lib/backtest-api";
import type { BacktestRunSummary, MergePreview } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { BatchProgress, type BatchState } from "./batch-progress";
import { CheckMark, DialogHead, Field } from "./dialog-parts";
import { RunStatusBadge } from "./shared";

type Props = { runs: BacktestRunSummary[]; open: boolean; onOpenChange: (open: boolean) => void; onMerged: () => void };

/** One backtest in a picker: its name, address count and window, and its status on the right. */
function RunRow({ run, on, disabled, onClick, check }: { run: BacktestRunSummary; on: boolean; disabled?: boolean; onClick: () => void; check?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role={check ? "checkbox" : "radio"}
      aria-checked={on}
      className={cn(
        "flex min-h-[52px] items-center gap-3 rounded-[14px] border bg-surface-2 px-3.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on ? "border-volt-line bg-volt-soft" : "border-border hover:border-line-2"
      )}
    >
      {check ? (
        <CheckMark checked={on} />
      ) : (
        <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-full border", on ? "border-primary" : "border-line-3")}>{on && <span className="size-2 rounded-full bg-primary" />}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
        <b className="truncate text-[13.5px] font-semibold">{run.name}</b>
        <span className="text-xs text-text-3">
          {run.addressCount.toLocaleString()} addresses · {run.days}d
        </span>
      </span>
      <RunStatusBadge status={run.status} control={run.control} queuePosition={run.progress.queuePosition} />
    </button>
  );
}

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
      <DialogContent className="sm:max-w-[640px]" onInteractOutside={(e) => working && e.preventDefault()} onEscapeKeyDown={(e) => working && e.preventDefault()}>
        {working && state ? (
          <BatchProgress
            title="Merging backtests…"
            note="Moving the addresses and their results a page at a time. If it is interrupted, run the merge again - what already moved stays moved."
            state={state}
            stopping={stopping}
            onStop={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          />
        ) : (
          <>
            <DialogHead
              icon={<GitMerge className="size-5" />}
              title="Merge backtests"
              help="Pick one to keep, then tick the ones to merge into it. Their addresses and results move over and they are removed. An address in more than one stays as it is in the one you keep."
              description="Fold several backtests into one."
            />

            <Field label="1. Keep this one">
              <div role="radiogroup" aria-label="Keep this one" className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {runs.map((r) => (
                  <RunRow
                    key={r._id}
                    run={r}
                    on={target === r._id}
                    onClick={() => {
                      setTarget(r._id);
                      setSources((prev) => {
                        const next = new Set(prev);
                        next.delete(r._id);
                        return next;
                      });
                      setPreview(null);
                    }}
                  />
                ))}
              </div>
            </Field>

            <Field label="2. Merge these into it" note={!target ? "Choose the backtest to keep first." : undefined}>
              <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {runs
                  .filter((r) => r._id !== target)
                  .map((r) => (
                    <RunRow key={r._id} run={r} check on={sources.has(r._id)} disabled={!target} onClick={() => toggleSource(r._id)} />
                  ))}
              </div>
            </Field>

            {preview && (
              <Field label="3. Check">
                <div className="flex flex-col gap-2">
                  {preview.sources.map((s) => (
                    <div
                      key={s._id}
                      className={cn(
                        "flex flex-col gap-1.5 rounded-[14px] border bg-surface-2 px-3.5 py-3",
                        s.blocked ? "border-destructive/40" : s.sameResults ? "border-positive/30" : "border-warn/40"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
                          {s.blocked ? <TriangleAlert className="size-4 shrink-0 text-destructive" /> : s.sameResults ? <CircleCheck className="size-4 shrink-0 text-positive" /> : <TriangleAlert className="size-4 shrink-0 text-warn" />}
                          <span className="truncate">{s.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-text-3">{s.addressCount.toLocaleString()} addresses</span>
                      </div>
                      {s.blocked ? (
                        <p className="text-xs text-destructive">{s.blocked}.</p>
                      ) : s.sameResults ? (
                        <p className="text-xs text-text-2">Same simulation settings - its results are kept as they are.</p>
                      ) : (
                        <>
                          <p className="text-xs leading-[18px] text-text-2">
                            Different settings, so its results are not comparable: {s.differences.map((d) => `${d.label} (${d.source} here, ${d.target} in "${preview.target.name}")`).join("; ")}.
                          </p>
                          <label className="flex items-start gap-2.5 text-xs leading-[18px] text-text-2">
                            <Checkbox
                              className="mt-px"
                              checked={keepResults.has(s._id)}
                              onCheckedChange={() =>
                                setKeepResults((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(s._id)) next.delete(s._id);
                                  else next.add(s._id);
                                  return next;
                                })
                              }
                            />
                            <span>Keep its existing results anyway (otherwise its addresses are simulated again with the settings of &quot;{preview.target.name}&quot;)</span>
                          </label>
                        </>
                      )}
                      {s.otherDifferences.length > 0 && !s.blocked && (
                        <p className="text-[11px] leading-4 text-text-3">
                          Also differs (does not change any result; the settings of &quot;{preview.target.name}&quot; apply from now on): {s.otherDifferences.map((d) => d.label).join(", ")}.
                        </p>
                      )}
                      {s.windowOffsetHours >= 6 && !s.blocked && (
                        <p className="text-[11px] leading-4 text-text-3">
                          Its period ends about {s.windowOffsetHours} hours {s.windowOffsetHours >= 24 ? `(${Math.round(s.windowOffsetHours / 24)} days) ` : ""}away from the kept one&apos;s. Results that are kept stay on the period they were collected for.
                        </p>
                      )}
                    </div>
                  ))}
                  <p className="text-xs leading-[18px] text-text-3">
                    {totalAddresses.toLocaleString()} addresses will move; {preview.sources.length} backtest{preview.sources.length === 1 ? "" : "s"} will be removed.
                    {rerunCount > 0 ? ` ${rerunCount.toLocaleString()} will be simulated again (already-collected data is reused, so that is much faster than the first time).` : ""}
                    {preview.target.status === "completed" || preview.target.status === "failed" ? " If the kept backtest has work waiting afterwards it is paused: press Resume to process just that." : ""}
                  </p>
                </div>
              </Field>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              {!preview ? (
                <Button className="gap-1.5" disabled={!target || sources.size === 0 || checking} onClick={check}>
                  {checking ? <Loader2 className="animate-spin" /> : <GitMerge />}
                  Check the merge
                </Button>
              ) : (
                <Button className="gap-1.5" disabled={blocked} onClick={merge}>
                  <GitMerge /> Merge {preview.sources.length} backtest{preview.sources.length === 1 ? "" : "s"}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
