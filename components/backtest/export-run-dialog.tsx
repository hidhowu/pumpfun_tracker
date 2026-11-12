"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { runExportUrl, type RunExportMode } from "@/lib/backtest-api";
import type { BacktestTraderQuery } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { DialogHead } from "./dialog-parts";

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
      <DialogContent className="sm:max-w-[520px]">
        <DialogHead
          icon={<Download className="size-5" />}
          title="Export to CSV"
          help={`Exports the ${matching.toLocaleString()} address${matching === 1 ? "" : "es"} matching your filters, search and sort - not just this page. Change the filters first to export a different set.`}
          description="Choose what the CSV contains."
        />
        <p className="-mt-1 text-[13px] text-text-2">
          <b className="font-semibold text-foreground">{matching.toLocaleString()}</b> address{matching === 1 ? "" : "es"} match your current filters.
        </p>
        <div role="radiogroup" aria-label="What to export" className="flex flex-col gap-2">
          {MODES.map((m) => {
            const on = mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setMode(m.value)}
                className={cn(
                  "flex items-start gap-3 rounded-[14px] border bg-surface-2 px-3.5 py-3 text-left transition-colors",
                  on ? "border-volt-line bg-volt-soft" : "border-border hover:border-line-2"
                )}
              >
                <span className={cn("mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-line-3")}>
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <b className="text-[13.5px] font-semibold">{m.title}</b>
                  <span className="text-xs leading-[18px] text-text-3">{m.description}</span>
                </span>
              </button>
            );
          })}
          {mode === "trades" && (
            <label className="flex items-center gap-2.5 px-1 pt-1 text-[13px] text-text-2">
              <Checkbox checked={includeSkipped} onCheckedChange={(v) => setIncludeSkipped(v === true)} />
              Also include signals that were looked at but not traded (dust, no data, ...)
            </label>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button className="gap-1.5" disabled={matching === 0} onClick={download}>
            <Download /> Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
