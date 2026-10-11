"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getListsOverview } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useProfile } from "@/lib/profile-context";
import type { ListOverview } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30_000;

const pnlTone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : undefined);

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

/** Every list side by side on the current profile; click one for its combined performance charts. */
export default function ListsPage() {
  const { currentProfileId, currentProfile } = useProfile();
  const [lists, setLists] = useState<ListOverview[] | null>(null);

  const load = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { lists } = await getListsOverview(currentProfileId);
      setLists(lists);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load lists");
    }
  }, [currentProfileId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Lists</h1>
        <p className="text-sm text-muted-foreground">
          Combined performance of each list&apos;s traders{currentProfile ? ` on profile "${currentProfile.name}"` : ""} - their whole history there, not
          just since they were tagged. Create lists and tag traders with the tag button on the Traders page.
        </p>
      </div>

      {lists === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 py-14 text-center text-sm text-muted-foreground">
          No lists yet - create one from the tag button on any trader on the Traders page.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lists.map((list) => (
            <Link key={list._id} href={`/lists/${list._id}`} className="group">
              <Card className="h-full border-border/60 transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListChecks className="size-4 text-primary" />
                    <span className="truncate">{list.name}</span>
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {list.traderCount} trader{list.traderCount === 1 ? "" : "s"}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  <Stat label="Today" value={formatUsd(list.todayPnlUsd)} className={pnlTone(list.todayPnlUsd)} />
                  <Stat label="Last 7 days" value={formatUsd(list.weekPnlUsd)} className={pnlTone(list.weekPnlUsd)} />
                  <Stat label="Lifetime realized" value={formatUsd(list.realizedPnlUsd)} className={pnlTone(list.realizedPnlUsd)} />
                  <Stat label="7d win rate" value={list.weekWinRatePercent != null ? `${list.weekWinRatePercent.toFixed(0)}%` : "—"} />
                  <Stat label="Open positions" value={list.openPositionCount} />
                  <Stat label="Closed trades" value={list.closedPositionCount} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
