"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { signedUsd, toneClass } from "./shared";
import { getDryDaily, resetDryRun } from "@/lib/live-wallet-api";
import { formatExactTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DryDaily, TradingSummary } from "@/lib/live-wallet-types";

const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** The last 7 days of one exit style, in dollars per day, with every other style beside it to compare. */
function DailyDialog({ walletId, styleId, onClose }: { walletId: string; styleId: string | null; onClose: () => void }) {
  const [daily, setDaily] = useState<DryDaily | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!styleId) return;
    let cancelled = false;
    getDryDaily(walletId)
      .then((d) => !cancelled && (setDaily(d), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load the daily results"));
    return () => {
      cancelled = true;
    };
  }, [walletId, styleId]);

  const style = daily?.styles.find((s) => s.id === styleId) ?? null;
  // The selected style first, then the rest in the order the wallet lists them.
  const ordered = daily ? [...daily.styles].sort((a, b) => Number(b.id === styleId) - Number(a.id === styleId)) : [];

  return (
    <Dialog open={!!styleId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{style ? style.label : "Exit way"}: day by day</DialogTitle>
          <DialogDescription>
            What this exit way made in dollars on each of the last 7 days (UTC), counted on the day it sold. The other ways are below, on the same entries.
            {daily?.dryResetAt ? ` Counting trades opened since the reset at ${formatExactTime(daily.dryResetAt)} UTC.` : ""}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : !daily ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <div className="flex flex-col gap-4">
            {style ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[...style.days].reverse().slice(0, 4).map((d, i) => (
                  <div key={d.date} className="rounded-xl border border-border bg-secondary/40 p-3">
                    <div className="text-xs font-bold text-muted-foreground">{i === 0 ? "Today" : i === 1 ? "Yesterday" : dayLabel(d.date)}</div>
                    <div className={cn("mt-1 text-lg font-extrabold tabular-nums", toneClass(d.trades ? d.pnlUsd : null))}>{d.trades ? signedUsd(d.pnlUsd) : "-"}</div>
                    <div className="text-xs text-muted-foreground">{d.trades} trade{d.trades === 1 ? "" : "s"}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-bold">Exit way</th>
                    {[...daily.days].reverse().map((d) => (
                      <th key={d} className="px-3 py-2 text-right font-bold whitespace-nowrap">{dayLabel(d)}</th>
                    ))}
                    <th className="px-3 py-2 text-right font-bold">7 days</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((s) => (
                    <tr key={s.id} className={cn("border-b border-border/60 last:border-0", s.id === styleId && "bg-primary/10")}>
                      <td className="px-3 py-2 font-bold whitespace-nowrap">{s.label}</td>
                      {[...s.days].reverse().map((d) => (
                        <td key={d.date} className={cn("px-3 py-2 text-right tabular-nums", toneClass(d.trades ? d.pnlUsd : null))} title={`${d.trades} trade${d.trades === 1 ? "" : "s"}, ${d.wins} winning`}>
                          {d.trades ? signedUsd(d.pnlUsd) : "-"}
                        </td>
                      ))}
                      <td className={cn("px-3 py-2 text-right font-extrabold tabular-nums", toneClass(s.trades ? s.totalUsd : null))}>{s.trades ? signedUsd(s.totalUsd) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Dry run: which exit way is better? Click a way for its last 7 days; the reset starts every way again from zero. */
export function DryRunComparison({ walletId, summary, onReset }: { walletId: string; summary: TradingSummary; onReset: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const d = summary.dryComparison;
  const hasDry = summary.dry.open + summary.dry.closed > 0;
  if (!d && !hasDry && !summary.dryResetAt) return null;

  async function reset() {
    setResetting(true);
    try {
      await resetDryRun(walletId);
      toast.success("Dry run reset - every exit way starts again from zero");
      onReset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't reset the dry run");
    } finally {
      setResetting(false);
    }
  }

  const best = d ? Math.max(...d.styles.map((x) => x.pnlUsd)) : 0;
  const tied = d ? d.styles.filter((x) => x.pnlUsd === best).length > 1 : false;

  return (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-extrabold">Dry run: which exit way is better?</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {d
              ? `Over ${d.trades} dry-run trade${d.trades === 1 ? "" : "s"} that every way has finished, the same entries exited ${d.styles.length} ways. Click a way to see its last 7 days.`
              : "No dry-run trade has been finished by every way yet."}
            {summary.dryResetAt ? ` Counting from the reset at ${formatExactTime(summary.dryResetAt)} UTC.` : ""}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={resetting}>
              {resetting ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Reset dry run
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the dry run?</AlertDialogTitle>
              <AlertDialogDescription>
                Every exit way (its own entry, follow simulation and the cool-downs) starts again from zero: the comparison and the day-by-day results count only the dry trades opened from now on. Nothing is deleted - the trades stay in the list below, and positions that are still open keep being worked.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={reset}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {d ? (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {d.styles.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setSelected(x.id)}
              className={cn("cursor-pointer rounded-xl border p-3 text-left transition-colors hover:border-primary/60", !tied && x.pnlUsd === best ? "border-positive/40 bg-positive/5" : "border-border bg-secondary/40")}
            >
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
                {x.label}
                {!tied && x.pnlUsd === best ? <span className="text-positive">better</span> : null}
              </div>
              <div className={cn("mt-1 text-xl font-extrabold tabular-nums", toneClass(x.pnlUsd))}>{signedUsd(x.pnlUsd)}</div>
              <div className="text-xs text-muted-foreground">{x.winRate.toFixed(0)}% winning · last 7 days →</div>
            </button>
          ))}
        </div>
      ) : null}
      <DailyDialog walletId={walletId} styleId={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
