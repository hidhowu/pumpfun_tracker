"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importBacktestViews, listBacktestRuns, previewBacktestViewImport } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestViewImportPreview, BacktestRunSummary } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

type Props = {
  /** The backtest the combined backtests are imported INTO. */
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

/**
 * Copies combined backtests from another backtest onto this one: the name, the addresses and the settings (balance, trade amount, fees) - never the trades.
 * Each copy is worked out from THIS backtest's trades, so a longer run of the same addresses gets the same combinations without creating them one by one.
 */
export function ImportViewsDialog({ runId, open, onOpenChange, onImported }: Props) {
  const [runs, setRuns] = useState<BacktestRunSummary[] | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [preview, setPreview] = useState<BacktestViewImportPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [allowPartial, setAllowPartial] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listBacktestRuns()
      .then(({ runs }) => !cancelled && setRuns(runs.filter((r) => r._id !== runId)))
      .catch(() => !cancelled && setRuns([]));
    return () => {
      cancelled = true;
    };
  }, [open, runId]);

  async function choose(id: string) {
    setSourceId(id);
    setPreview(null);
    setPicked(new Set());
    setLoadingPreview(true);
    try {
      const p = await previewBacktestViewImport(runId, id);
      setPreview(p);
      // Everything that can be copied whole is ticked; the rest is up to the user.
      setPicked(new Set(p.views.filter((v) => v.allAddresses || v.presentCount === v.addressCount).map((v) => v._id)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to read that backtest");
    } finally {
      setLoadingPreview(false);
    }
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run() {
    setBusy(true);
    try {
      const res = await importBacktestViews(runId, { sourceRunId: sourceId, viewIds: [...picked], allowPartial });
      const parts = [`${res.imported.length} combined backtest${res.imported.length === 1 ? "" : "s"} imported`];
      if (res.partial) parts.push(`${res.partial} with only the addresses this backtest has`);
      if (res.duplicates) parts.push(`${res.duplicates} already here`);
      if (res.skipped.length) parts.push(`${res.skipped.length} skipped (${res.skipped.map((s) => `${s.name}: ${s.reason}`).join("; ")})`);
      if (res.imported.length > 0) toast.success(parts.join(" · "));
      else toast.message(parts.join(" · "));
      onImported();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to import");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[88vh] grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-4" /> Import combined backtests
          </DialogTitle>
          <DialogDescription>
            Copies the name, addresses and settings of combined backtests from another backtest onto this one - not its trades. They are worked out from this backtest&apos;s own trades, so
            only addresses this backtest has can be used.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="min-w-0 space-y-1.5">
            <Label>Import from</Label>
            <Select value={sourceId} onValueChange={choose} disabled={busy}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={runs === null ? "Loading backtests…" : runs.length === 0 ? "No other backtests" : "Choose a backtest"} />
              </SelectTrigger>
              <SelectContent>
                {(runs ?? []).map((r) => (
                  <SelectItem key={r._id} value={r._id}>
                    {r.name} · {r.days}d · {r.addressCount.toLocaleString()} addresses
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loadingPreview && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Reading its combined backtests…
            </p>
          )}

          {preview && preview.views.length === 0 && <p className="text-sm text-muted-foreground">&quot;{preview.sourceName}&quot; has no combined backtests to import.</p>}

          {preview && preview.views.length > 0 && (
            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{picked.size} of {preview.views.length} selected</Label>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(preview.views.map((v) => v._id)))}>
                    All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
                    None
                  </Button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
                {preview.views.map((v) => {
                  const whole = v.allAddresses || v.presentCount === v.addressCount;
                  const none = !v.allAddresses && v.presentCount === 0;
                  return (
                    <label key={v._id} className={cn("flex cursor-pointer items-start gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/40", none && "opacity-60")}>
                      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={picked.has(v._id)} onChange={() => toggle(v._id)} disabled={busy} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{v.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatUsd(v.startingBalanceUsd)} start · {formatUsd(v.tradeSizeUsd)}/trade · {v.pumpFeePercent}% + {formatUsd(v.jitoFeeUsd)}
                          {v.resetDaily ? " · daily reset" : ""}
                        </span>
                        <span className={cn("block text-xs", whole ? "text-muted-foreground" : none ? "text-negative" : "text-amber-500")}>
                          {v.allAddresses
                            ? "every address"
                            : whole
                              ? `${v.addressCount} address${v.addressCount === 1 ? "" : "es"} - all in this backtest`
                              : `${v.presentCount} of ${v.addressCount} addresses are in this backtest`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>

              {preview.views.some((v) => !v.allAddresses && v.presentCount !== v.addressCount) && (
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="bt-import-partial">Also import combinations with missing addresses</Label>
                    <p className="text-xs text-muted-foreground">
                      Off: a combination that is missing any address is skipped, so every imported one is exactly what you made. On: it is imported with only the addresses this backtest has.
                    </p>
                  </div>
                  <Switch id="bt-import-partial" checked={allowPartial} onCheckedChange={setAllowPartial} disabled={busy} />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={run} disabled={busy || picked.size === 0} className="gap-1.5">
            {busy && <Loader2 className="size-4 animate-spin" />}
            Import {picked.size > 0 ? picked.size : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
