"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Loader2, RotateCcw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { DialogHead } from "@/components/ui/dialog-parts";
import { HelpTip } from "@/components/ui/help-tip";
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHead
          icon={<CalendarDays className="size-5" />}
          title={`${style ? style.label : "Exit way"}: day by day`}
          help={`What this exit way made in dollars on each of the last 7 days (UTC), counted on the day it sold. The other ways are below, on the same entries.${daily?.dryResetAt ? ` Counting trades opened since the reset at ${formatExactTime(daily.dryResetAt)} UTC.` : ""}`}
          description="The last 7 days of this exit way next to the others."
        />

        {error ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-neg-soft p-3 text-sm text-[#ffc9d0]">
            {error}
          </div>
        ) : !daily ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {style ? (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[...style.days].reverse().slice(0, 4).map((d, i) => (
                  <div key={d.date} className="rounded-xl border border-border bg-surface-2 px-3.5 py-3">
                    <div className="text-xs text-text-3">{i === 0 ? "Today" : i === 1 ? "Yesterday" : dayLabel(d.date)}</div>
                    <div className={cn("mt-1 text-[18px] leading-6 font-semibold tabular-nums", d.trades ? toneClass(d.pnlUsd) : "text-text-3")}>{d.trades ? signedUsd(d.pnlUsd) : "—"}</div>
                    <div className="text-xs text-text-3">
                      {d.trades} trade{d.trades === 1 ? "" : "s"}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Eight columns do not fit a phone: the table scrolls sideways inside its own frame and the exit-way column stays in view. */}
            <div className="max-w-full overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">
                    <th className="sticky left-0 z-10 bg-card px-3 py-2.5 font-medium whitespace-nowrap">Exit way</th>
                    {[...daily.days].reverse().map((d) => (
                      <th key={d} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                        {dayLabel(d)}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">7 days</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((s) => (
                    <tr key={s.id} className={cn("border-b border-border last:border-0", s.id === styleId && "bg-volt-soft")}>
                      <td className={cn("sticky left-0 z-10 bg-card px-3 py-2.5 font-medium whitespace-nowrap", s.id === styleId && "bg-[color-mix(in_srgb,var(--card),var(--primary)_9%)] text-primary")}>{s.label}</td>
                      {[...s.days].reverse().map((d) => (
                        <td key={d.date} className={cn("px-3 py-2.5 text-right tabular-nums", d.trades ? toneClass(d.pnlUsd) : "text-text-3")} title={`${d.trades} trade${d.trades === 1 ? "" : "s"}, ${d.wins} winning`}>
                          {d.trades ? signedUsd(d.pnlUsd) : "—"}
                        </td>
                      ))}
                      <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", s.trades ? toneClass(s.totalUsd) : "text-text-3")}>{s.trades ? signedUsd(s.totalUsd) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
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
    <section className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <b className="text-[15px] font-semibold">
            Which exit way is better?
            <HelpTip>
              {d
                ? `Over ${d.trades} dry-run trade${d.trades === 1 ? "" : "s"} that every way has finished, the same entries exited ${d.styles.length} ways. Click a way for its last 7 days.`
                : "Dry-run trades finished by every way. Click a way for its last 7 days."}
            </HelpTip>
          </b>
          <p className="text-[13px] leading-5 text-text-2">
            {d ? `${d.trades} dry-run trade${d.trades === 1 ? "" : "s"}, every way finished.` : "No dry-run trade has been finished by every way yet."}
            {summary.dryResetAt ? ` Counting from the reset at ${formatExactTime(summary.dryResetAt)} UTC.` : ""}
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 max-md:h-10" disabled={resetting}>
              {resetting ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset dry run
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Reset the dry run?
                <HelpTip>Live and Simulation are running totals. Exit ways are the dry run&apos;s results over the last 7 days.</HelpTip>
              </AlertDialogTitle>
              <AlertDialogDescription>
                Every exit way (its own entry, follow simulation and the cool-downs) restarts from zero: the comparison and the day-by-day results count only the dry trades opened from now on. Nothing is deleted - the trades stay in the list below, and positions still open keep being worked.
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
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {d.styles.map((x) => {
            const isBest = !tied && x.pnlUsd === best;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => setSelected(x.id)}
                className={cn(
                  "flex min-h-[84px] cursor-pointer flex-col gap-1 rounded-[14px] border bg-surface-2 px-3.5 py-3 text-left transition-colors hover:border-line-3",
                  isBest ? "border-positive/40 bg-pos-soft" : "border-border"
                )}
              >
                <span className="flex items-center justify-between gap-2 text-xs text-text-2">
                  {x.label}
                  {isBest ? <span className="inline-flex h-5 items-center rounded-full border border-positive/30 bg-pos-soft px-2 text-[11px] font-medium text-positive">better</span> : null}
                </span>
                <b className={cn("text-[20px] leading-6 font-semibold tabular-nums", toneClass(x.pnlUsd))}>{signedUsd(x.pnlUsd)}</b>
                <span className="text-xs text-text-3">{x.winRate.toFixed(0)}% winning · last 7 days →</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <DailyDialog walletId={walletId} styleId={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
