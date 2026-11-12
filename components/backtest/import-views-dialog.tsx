"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsList, SettingsRow } from "@/components/ui/settings-row";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { importBacktestViews, listBacktestRuns, previewBacktestViewImport } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestViewImportPreview, BacktestRunSummary } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { CheckMark, DialogHead, Field } from "./dialog-parts";

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
      <DialogContent className="sm:max-w-[560px]">
        <DialogHead
          icon={<Download className="size-5" />}
          title="Import combined backtests"
          help="Copies the name, addresses and settings of combined backtests from another backtest onto this one - not its trades. They are worked out from this backtest's own trades, so only addresses it has can be used."
          description="Choose a backtest and the combined backtests to copy."
        />

        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Import from" htmlFor="import-views-source">
            <Select value={sourceId} onValueChange={choose} disabled={busy}>
              <SelectTrigger id="import-views-source" className="w-full max-md:h-11">
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
          </Field>

          {loadingPreview && (
            <p className="flex items-center gap-2 text-xs text-text-3">
              <Loader2 className="size-3.5 animate-spin" /> Reading its combined backtests…
            </p>
          )}

          {preview && preview.views.length === 0 && <p className="text-sm text-text-2">&quot;{preview.sourceName}&quot; has no combined backtests to import.</p>}

          {preview && preview.views.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  {picked.size} of {preview.views.length} selected
                </span>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setPicked(new Set(preview.views.map((v) => v._id)))}>
                    All
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPicked(new Set())}>
                    None
                  </Button>
                </div>
              </div>
              <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                {preview.views.map((v) => {
                  const whole = v.allAddresses || v.presentCount === v.addressCount;
                  const none = !v.allAddresses && v.presentCount === 0;
                  const on = picked.has(v._id);
                  return (
                    <button
                      key={v._id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={busy}
                      onClick={() => toggle(v._id)}
                      className={cn(
                        "flex items-start gap-3 rounded-[14px] border bg-surface-2 px-3.5 py-3 text-left transition-colors",
                        on ? "border-volt-line bg-volt-soft" : "border-border hover:border-line-2",
                        none && "opacity-60"
                      )}
                    >
                      <CheckMark checked={on} className="mt-0.5" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <b className="truncate text-[13.5px] font-semibold">{v.name}</b>
                        <span className="text-xs text-text-3">
                          {formatUsd(v.startingBalanceUsd)} start · {formatUsd(v.tradeSizeUsd)}/trade · {v.pumpFeePercent}% + {formatUsd(v.jitoFeeUsd)}
                          {v.resetDaily ? " · daily reset" : ""}
                        </span>
                        <span className={cn("text-xs", whole ? "text-text-2" : none ? "text-negative" : "text-warn")}>
                          {v.allAddresses
                            ? "every address"
                            : whole
                              ? `${v.addressCount} address${v.addressCount === 1 ? "" : "es"} - all in this backtest`
                              : `${v.presentCount} of ${v.addressCount} addresses are in this backtest`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {preview.views.some((v) => !v.allAddresses && v.presentCount !== v.addressCount) && (
                <SettingsList>
                  <SettingsRow
                    label="Also import combinations with missing addresses"
                    help="Off: combinations missing any address are skipped. On: they are imported with only the addresses this backtest has."
                    htmlFor="bt-import-partial"
                  >
                    <Switch id="bt-import-partial" checked={allowPartial} onCheckedChange={setAllowPartial} disabled={busy} />
                  </SettingsRow>
                </SettingsList>
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
            {busy && <Loader2 className="animate-spin" />}
            Import {picked.size > 0 ? picked.size : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
