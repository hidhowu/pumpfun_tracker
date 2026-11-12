"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, ListChecks, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { ListNameDialog } from "@/components/lists/list-name-dialog";
import { createTraderList, getListsOverview } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useProfile } from "@/lib/profile-context";
import type { ListOverview } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30_000;

const pnlTone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : undefined);
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function Stat({ label, short, value, className }: { label: string; short?: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-xs text-text-3">
        {short ? <span className="md:hidden">{short}</span> : null}
        <span className={cn(short && "max-md:hidden")}>{label}</span>
      </span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-surface-3 text-primary", className)}>
      <ListChecks className="size-[18px]" />
    </span>
  );
}

/** Every list side by side on the current profile; click one for its combined performance charts. */
export default function ListsPage() {
  const { currentProfileId, currentProfile } = useProfile();
  const [lists, setLists] = useState<ListOverview[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { lists } = await getListsOverview(currentProfileId);
      setLists(lists);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
      toast.error(e instanceof Error ? e.message : "Failed to load lists");
    }
  }, [currentProfileId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  async function handleCreate(name: string) {
    try {
      await createTraderList(name);
      toast.success(`List "${name}" created`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create list");
      throw e;
    }
  }

  const help = (
    <HelpTip>
      Combined performance of each list&apos;s traders{currentProfile ? ` on "${currentProfile.name}"` : ""} - their whole history there, not just since they were tagged.
    </HelpTip>
  );

  // The card with the best lifetime result gets the lime outline (only when there is more than one list and it is actually in profit).
  const best = lists && lists.length > 1 ? lists.reduce((a, b) => (b.realizedPnlUsd > a.realizedPnlUsd ? b : a)) : null;
  const bestListId = best && best.realizedPnlUsd > 0 ? best._id : null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex items-end justify-between gap-4">
        <h1 className="hidden text-[28px] leading-[34px] font-semibold tracking-[-0.025em] md:block">
          Lists
          {help}
        </h1>
        <span className="flex items-center gap-1 text-[13px] text-text-3 md:hidden">
          Combined performance per list
          {help}
        </span>
        <Button onClick={() => setCreating(true)} className="gap-1.5">
          <Plus className="size-4" strokeWidth={2.2} />
          New list
        </Button>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <b>Couldn&apos;t load the lists.</b> {lists ? "Showing the last data received." : "Try again in a moment."}
          </span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {lists === null ? (
        !loadError && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-5">
                <Skeleton className="h-[18px] w-3/5" />
                <Skeleton className="h-3" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        )
      ) : lists.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <ListChecks className="size-6" />
          </span>
          <b className="text-[15px] font-semibold">No lists yet</b>
          <p className="max-w-[420px] text-[13px] text-text-2">Create one here, then tag traders from the tag button on the Traders page.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setCreating(true)} className="gap-1.5">
              <Plus className="size-4" strokeWidth={2.2} />
              New list
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">Go to Traders</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
          {lists.map((list) => (
            <Link
              key={list._id}
              href={`/lists/${list._id}`}
              aria-label={list._id === bestListId ? `${list.name} (best performing list)` : undefined}
              className={cn(
                "group flex min-w-0 flex-col gap-4 rounded-[20px] border bg-card p-4 transition-colors hover:border-line-3 md:p-5",
                list._id === bestListId ? "border-volt-line" : "border-border"
              )}
            >
              <div className="flex items-center gap-2.5">
                <ListIcon />
                <div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-2.5">
                  <b className="truncate text-[15px] font-semibold md:flex-1">{list.name}</b>
                  <span className="text-xs text-text-3">
                    {list.traderCount} trader{list.traderCount === 1 ? "" : "s"}
                  </span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-text-3 transition-colors group-hover:text-foreground" />
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-3.5 border-t border-border pt-3.5 md:grid-cols-2 md:gap-x-4 md:pt-4">
                <Stat label="Today" value={signedUsd(list.todayPnlUsd)} className={pnlTone(list.todayPnlUsd)} />
                <Stat label="Last 7 days" short="7 days" value={signedUsd(list.weekPnlUsd)} className={pnlTone(list.weekPnlUsd)} />
                <Stat label="Lifetime realized" short="Lifetime" value={signedUsd(list.realizedPnlUsd)} className={pnlTone(list.realizedPnlUsd)} />
                <Stat label="7d win rate" short="7d win" value={list.weekWinRatePercent != null ? `${list.weekWinRatePercent.toFixed(0)}%` : "—"} />
                <Stat label="Open positions" short="Open" value={list.openPositionCount} />
                <Stat label="Closed trades" short="Closed" value={list.closedPositionCount} />
              </div>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-8 text-center transition-colors hover:border-primary/60 hover:bg-card md:min-h-[250px]"
          >
            <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
              <Plus className="size-6" />
            </span>
            <b className="text-[15px] font-semibold">Create a list</b>
            <span className="text-[13px] text-text-2">Name it, then tag traders from the Traders table.</span>
          </button>
        </div>
      )}

      <ListNameDialog open={creating} onOpenChange={setCreating} title="New list" submitLabel="Create list" onSubmit={handleCreate} />
    </div>
  );
}
