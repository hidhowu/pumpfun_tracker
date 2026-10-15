"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runExportUrl, type RunExportMode } from "@/lib/backtest-api";
import type { BacktestTraderQuery } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

const MODES: Array<{ value: RunExportMode; title: string; description: string }> = [
  { value: "addresses", title: "Addresses only", description: "One column: the address. Ready to paste into a list or back into the backtest list." },
  { value: "summary", title: "Addresses with their results", description: "One row per address: label, status, P&L, win rate, trades, loss days, profit margin and the other figures shown in the table." },
  { value: "trades", title: "Addresses with every trade", description: "One row per trade of each address: token, buy and sell times and prices, amounts, fees, how it closed, and the P&L." },
];

/** Downloads the addresses the table is showing (its filter, limits, search and sort - not just the page on screen) as a CSV. */
export function ExportRunDialog({ open, onOpenChange, runId, query, matching }: { open: boolean; onOpenChange: (open: boolean) => void; runId: string; query: BacktestTraderQuery; matching: number }) {
  const [mode, setMode] = useState<RunExportMode>("addresses");
  const [includeSkipped, setIncludeSkipped] = useState(false);

  function download() {
    // A plain link, so the browser streams the file to disk as the server produces it (nothing is held in the page's memory, however big it is).
    const a = document.createElement("a");
    a.href = runExportUrl(runId, query, mode, includeSkipped);
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success("Export started - your browser is downloading it" + (matching > 20_000 ? ". A large export can take a few minutes; it is saved as it is prepared." : ""));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export to CSV</DialogTitle>
          <DialogDescription>
            Exports the <span className="font-medium text-foreground">{matching.toLocaleString()}</span> address{matching === 1 ? "" : "es"} matching your current filters, search and sort - not just
            the page you are looking at. Change the filters first to export a different set.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn("flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors", mode === m.value ? "border-primary bg-primary/5" : "border-border/60 hover:bg-muted/40")}
            >
              <span className="text-sm font-medium">{m.title}</span>
              <span className="text-xs text-muted-foreground">{m.description}</span>
            </button>
          ))}
          {mode === "trades" && (
            <label className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
              <input type="checkbox" className="size-4 accent-primary" checked={includeSkipped} onChange={(e) => setIncludeSkipped(e.target.checked)} />
              Also include signals that were looked at but not traded (dust, no data, ...)
            </label>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button className="gap-1.5" disabled={matching === 0} onClick={download}>
            <Download className="size-4" /> Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
