"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Flame, Minus, Snowflake, Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getLeaderboard } from "@/lib/api";
import { formatAddress, formatUsd } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type Period = "day" | "week" | "month";

const RANK_STYLES: Record<number, string> = {
  0: "bg-amber-400/15 text-amber-400 border-amber-400/30",
  1: "bg-slate-300/15 text-slate-300 border-slate-300/30",
  2: "bg-orange-400/15 text-orange-400 border-orange-400/30",
};

function RankBadge({ rank }: { rank: number }) {
  const style = RANK_STYLES[rank];
  if (!style) {
    return <span className="flex size-7 items-center justify-center text-sm text-muted-foreground">{rank + 1}</span>;
  }
  return (
    <div className={cn("flex size-7 items-center justify-center rounded-full border text-sm font-semibold", style)}>
      {rank + 1}
    </div>
  );
}

function StreakBadge({ streak }: { streak: LeaderboardEntry["streaks"]["currentStreak"] }) {
  if (streak.type === "none" || streak.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (streak.type === "profit") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-positive">
        <Flame className="size-3.5" /> {streak.length}-day win streak
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-negative">
      <Snowflake className="size-3.5" /> {streak.length}-day loss streak
    </span>
  );
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const { leaderboard } = await getLeaderboard(p);
      setEntries(leaderboard);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(period);
  }, [period, refresh]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Trophy className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              Ranked by combined P&amp;L — the sum of each closed trade&apos;s % return, not luck from still-open positions.
            </p>
          </div>
        </div>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading && !entries ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : !entries || entries.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
          <p className="text-sm text-muted-foreground">No active traders to rank yet.</p>
        </div>
      ) : (
        <Card className="overflow-hidden border-border/60">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="w-12 pl-4">Rank</TableHead>
                  <TableHead>Trader</TableHead>
                  <TableHead className="text-right">Combined P&amp;L</TableHead>
                  <TableHead className="text-right">Actualized P&amp;L</TableHead>
                  <TableHead className="text-right">Closed trades</TableHead>
                  <TableHead className="pr-4">Streak</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, i) => {
                  const positive = entry.combinedPercent > 0;
                  const negative = entry.combinedPercent < 0;
                  return (
                    <TableRow key={entry.address} className="border-border/60">
                      <TableCell className="pl-4">
                        <RankBadge rank={i} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`/traders/${entry.address}`}
                            className="group flex items-center gap-1 font-mono text-sm hover:text-primary"
                          >
                            {formatAddress(entry.address, 5)}
                            <ArrowUpRight className="size-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
                          </Link>
                          {entry.label ? <span className="text-xs text-muted-foreground">{entry.label}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1",
                            positive && "text-positive",
                            negative && "text-negative"
                          )}
                        >
                          {positive ? (
                            <TrendingUp className="size-3.5" />
                          ) : negative ? (
                            <TrendingDown className="size-3.5" />
                          ) : (
                            <Minus className="size-3.5 text-muted-foreground" />
                          )}
                          {entry.combinedPercent.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        <span
                          className={cn(
                            (entry.actualizedUsd ?? 0) > 0 && "text-positive",
                            (entry.actualizedUsd ?? 0) < 0 && "text-negative"
                          )}
                        >
                          {formatUsd(entry.actualizedUsd)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{entry.closedTradeCount}</TableCell>
                      <TableCell className="pr-4">
                        <StreakBadge streak={entry.streaks.currentStreak} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
