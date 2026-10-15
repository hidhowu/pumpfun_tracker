"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{note}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" />
            {state.done.toLocaleString()} of {state.total.toLocaleString()}
          </span>
          <span className="text-sm tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
        </div>
        <ProgressBar percent={percent} className="h-2" />
        {state.lines.length > 0 && <p className="text-xs text-muted-foreground">{state.lines.join(" · ")}</p>}
      </div>
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
