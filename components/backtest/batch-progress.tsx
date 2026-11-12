"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { DialogHead } from "./dialog-parts";
import { ProgressBar } from "./shared";

export type BatchState = { done: number; total: number; lines: string[] };

/**
 * The "working through a big job in batches" screen shared by the dialogs that add, move or merge thousands of addresses: what is happening, a
 * progress bar, a few live totals, and a Stop button that ends it after the batch in flight. (Closing the dialog is disabled while it runs.)
 */
export function BatchProgress({ title, note, state, stopping, onStop }: { title: string; note: string; state: BatchState; stopping: boolean; onStop?: () => void }) {
  const percent = state.total > 0 ? Math.min(100, (state.done / state.total) * 100) : 0;
  return (
    <>
      <DialogHead icon={<Loader2 className="size-5 animate-spin" />} title={title} help={note} description={note} />
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium tabular-nums">
            {state.done.toLocaleString()} of {state.total.toLocaleString()}
          </span>
          <b className="text-sm font-semibold tabular-nums text-primary">{Math.round(percent)}%</b>
        </div>
        <ProgressBar percent={percent} className="h-2" />
        {state.lines.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
            {state.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        )}
      </div>
      <p className="-mt-1 text-xs text-text-3">Closing is disabled while it works.</p>
      {onStop && (
        <DialogFooter>
          <Button variant="outline" disabled={stopping} onClick={onStop}>
            {stopping ? "Stopping after this batch…" : "Stop"}
          </Button>
        </DialogFooter>
      )}
    </>
  );
}
