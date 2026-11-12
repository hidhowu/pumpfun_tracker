"use client";

import { CopyButton } from "@/components/copy-button";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Ban,
  Flame,
  Loader2,
  Minus,
  Search,
  Snowflake,
  Trophy,
  TriangleAlert,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Pager } from "@/components/ui/pager";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TraderAvatar } from "@/components/traders/trader-avatar";
import { getLeaderboard, updateTrader } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress, formatUsd } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type Period = "day" | "week" | "month";
type SortKey = "combinedPercent" | "actualizedUsd" | "closedTradeCount";
type SortDir = "asc" | "desc";

const PERIODS: Period[] = ["day", "week", "month"];
const PAGE_SIZE = 10;

const SORT_ACCESSORS: Record<SortKey, (e: LeaderboardEntry) => number> = {
  combinedPercent: (e) => e.combinedPercent,
  actualizedUsd: (e) => e.actualizedUsd ?? -Infinity,
  closedTradeCount: (e) => e.closedTradeCount,
};

// Gold / silver / bronze, as in the design - the same colour for the medal on the podium, in the table and on phone cards.
const MEDALS = ["#f3d27a", "#d4dcd7", "#e0a678"];

const toneText = (n: number | null | undefined) => (n == null || n === 0 ? "text-text-3" : n > 0 ? "text-positive" : "text-negative");

function signedUsd(value: number | null) {
  if (value === null) return "-";
  return `${value > 0 ? "+" : ""}${formatUsd(value)}`;
}

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className="text-right" aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex flex-row-reverse items-center gap-1 text-[11px] font-medium tracking-[0.07em] uppercase transition-colors hover:text-foreground",
          isActive ? "text-foreground" : "text-text-3"
        )}
      >
        {label}
        <Icon className={cn("size-3", isActive ? "text-primary" : "opacity-50")} />
      </button>
    </TableHead>
  );
}

/** The rank number: a gold / silver / bronze disc for the top three; after that a plain number (or, with `disc`, a neutral disc). */
function RankDisc({ rank, disc, className }: { rank: number; disc?: boolean; className?: string }) {
  const medal = MEDALS[rank - 1];
  if (!medal && !disc) return <span className={cn("text-[13px] text-text-3 tabular-nums", className)}>{rank}</span>;
  return (
    <span
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-semibold", medal ? "text-[#1b1405]" : "bg-surface-4 text-text-2", className)}
      style={medal ? { background: medal } : undefined}
    >
      {rank}
    </span>
  );
}

function StreakBadge({ streak, short }: { streak: LeaderboardEntry["streaks"]["currentStreak"]; short?: boolean }) {
  if (streak.type === "none" || streak.length === 0) {
    return <span className="text-xs text-text-3">—</span>;
  }
  const profit = streak.type === "profit";
  const Icon = profit ? Flame : Snowflake;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap",
        profit ? "border-positive/30 bg-pos-soft text-positive" : "border-destructive/30 bg-neg-soft text-destructive"
      )}
    >
      <Icon className="size-3" />
      {streak.length}-day {profit ? "win" : "loss"}
      {short ? "" : " streak"}
    </span>
  );
}

function AddressChip({ address, className }: { address: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground", className)}>
      <Link href={`/traders/${address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        {formatAddress(address, 5)}
        <ArrowUpRight className="size-3" />
      </Link>
      <CopyButton value={address} label="address" />
    </span>
  );
}

function CombinedValue({ value, className }: { value: number; className?: string }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <b className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", toneText(value), className)}>
      <Icon className="size-3" />
      {signedPercent(value)}
    </b>
  );
}

export default function LeaderboardPage() {
  const { currentProfileId } = useProfile();
  const [period, setPeriod] = useState<Period>("week");
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("combinedPercent");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  // The trader whose "Blacklist" confirmation is open (one dialog for the whole page).
  const [confirmAddress, setConfirmAddress] = useState<string | null>(null);

  const refresh = useCallback(
    async (p: Period) => {
      if (!currentProfileId) return;
      setLoading(true);
      try {
        const { leaderboard } = await getLeaderboard(currentProfileId, p);
        setEntries(leaderboard);
        setLoadError(false);
      } catch (e) {
        setLoadError(true);
        toast.error(e instanceof Error ? e.message : "Failed to load leaderboard");
      } finally {
        setLoading(false);
      }
    },
    [currentProfileId]
  );

  useEffect(() => {
    refresh(period);
  }, [period, refresh]);

  function changePeriod(p: Period) {
    setPeriod(p);
    setPage(1);
  }

  function changeQuery(value: string) {
    setQuery(value);
    setPage(1);
  }

  function handleSort(key: SortKey) {
    setPage(1);
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc"); // every leaderboard column reads naturally highest-first
    }
  }

  // The rank is the place by combined P&L (the order the API returns) and stays put whichever column the table is sorted by.
  const rankByAddress = useMemo(() => new Map((entries ?? []).map((e, i) => [e.address, i + 1])), [entries]);
  const podium = (entries ?? []).slice(0, 3);

  const sortedEntries = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    const filtered = q ? entries.filter((e) => e.address.toLowerCase().includes(q) || (e.label ?? "").toLowerCase().includes(q)) : entries;
    const accessor = SORT_ACCESSORS[sortKey];
    const sorted = [...filtered].sort((a, b) => accessor(a) - accessor(b));
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [entries, query, sortKey, sortDir]);

  // The podium already shows the top three, so the desktop table starts at rank 4 (a search looks through everyone). Phones list every trader as a card.
  const wide = useMediaQuery("(min-width: 768px)");
  const tableEntries = useMemo(() => (wide && !query.trim() ? sortedEntries.filter((e) => (rankByAddress.get(e.address) ?? 0) > podium.length) : sortedEntries), [wide, query, sortedEntries, rankByAddress, podium.length]);

  const pageCount = Math.max(1, Math.ceil(tableEntries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedEntries = useMemo(() => tableEntries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [tableEntries, currentPage]);

  async function handleBlacklist(address: string) {
    if (!currentProfileId) return;
    setPendingAddress(address);
    try {
      await updateTrader(currentProfileId, address, { status: "blacklisted" });
      toast.success("Trader blacklisted");
      await refresh(period);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to blacklist trader");
    } finally {
      setPendingAddress(null);
    }
  }

  const confirmTarget = confirmAddress ? entries?.find((e) => e.address === confirmAddress) : null;
  const periodLabel = period === "day" ? "today" : `this ${period}`;
  const hasEntries = !!entries && entries.length > 0;

  const periodSwitch = (
    <div className="flex items-center rounded-xl border border-border bg-card p-[3px] max-md:grid max-md:w-full max-md:grid-cols-3" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={period === p}
          onClick={() => changePeriod(p)}
          className={cn("h-[30px] rounded-[9px] px-3.5 text-[13px] font-medium capitalize transition-colors max-md:h-10", period === p ? "bg-surface-4 text-foreground" : "text-text-2 hover:text-foreground")}
        >
          {p}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="hidden text-[28px] leading-[34px] font-semibold tracking-[-0.025em] md:block">
          Leaderboard
          <HelpTip>Ranked by combined P&amp;L: the sum of each closed trade&apos;s % return.</HelpTip>
        </h1>
        {periodSwitch}
      </div>
      <div className="flex items-center gap-1 text-[13px] text-text-3 md:hidden">
        Ranked by combined P&amp;L
        <HelpTip className="ml-0">Ranked by combined P&amp;L: the sum of each closed trade&apos;s % return.</HelpTip>
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <b>Couldn&apos;t load the leaderboard.</b> {entries ? "Showing the last data received." : "Try again in a moment."}
          </span>
          <Button variant="outline" size="sm" onClick={() => void refresh(period)}>
            Retry
          </Button>
        </div>
      )}

      {loading && !entries ? (
        <div className="flex flex-col gap-3">
          <div className="hidden gap-4 md:grid md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[196px] rounded-[20px]" />
            ))}
          </div>
          <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : !hasEntries ? (
        !loadError && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center">
            <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
              <Trophy className="size-6" />
            </span>
            <b className="text-[15px] font-semibold">No active traders to rank yet.</b>
            <span className="text-[13px] text-text-2">Add traders to see them ranked.</span>
          </div>
        )
      ) : (
        <>
          {/* Podium: the top three by combined P&L (desktop; phones show the medals on the cards below). */}
          <div className="hidden gap-4 md:grid md:grid-cols-3">
            {podium.map((entry, i) => (
              <div
                key={entry.address}
                className="flex min-w-0 flex-col gap-4 rounded-[20px] border bg-card p-5 transition-colors hover:border-line-3"
                style={{ borderColor: i === 0 ? "rgba(243,210,122,.45)" : undefined }}
              >
                <div className="flex items-center justify-between">
                  <TraderAvatar address={entry.address} size="xl" />
                  <RankDisc rank={i + 1} className="size-8 text-sm" />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <b className={cn("truncate text-[17px] font-semibold", !entry.label && "font-normal text-text-3")}>{entry.label || "Unlabeled"}</b>
                  <AddressChip address={entry.address} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-xs text-text-3">Combined P&amp;L</span>
                    <b className={cn("text-[26px] leading-8 font-semibold tracking-[-0.02em] tabular-nums", toneText(entry.combinedPercent))}>{signedPercent(entry.combinedPercent)}</b>
                  </div>
                  <div className="flex min-w-0 flex-col items-end">
                    <span className="text-xs text-text-3">Actualized</span>
                    <b className={cn("font-semibold tabular-nums", toneText(entry.actualizedUsd))}>{signedUsd(entry.actualizedUsd)}</b>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-text-3">
                  <span>{entry.closedTradeCount} closed trades</span>
                  <span className="flex items-center gap-1.5">
                    <StreakBadge streak={entry.streaks.currentStreak} />
                    <Button variant="ghost" size="xs" disabled={pendingAddress === entry.address} onClick={() => setConfirmAddress(entry.address)} className="text-text-3 hover:text-negative" aria-label={`Blacklist ${entry.label || formatAddress(entry.address, 5)}`}>
                      {pendingAddress === entry.address ? <Loader2 className="animate-spin" /> : <Ban />}
                      Blacklist
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-card max-md:border-0 max-md:bg-transparent">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border p-3 max-md:border-0 max-md:p-0 md:px-4">
              <b className="hidden text-[15px] font-semibold md:inline">All ranked traders</b>
              <span className="hidden text-xs text-text-3 md:inline">
                {query ? `${sortedEntries.length} of ${entries.length}` : entries.length} trader{entries.length === 1 ? "" : "s"} · {periodLabel}
              </span>
              <div className="hidden flex-1 md:block" />
              <span className="hidden text-xs text-text-3 md:inline">Click a column header to sort</span>
              <label className="flex h-9 w-60 items-center gap-2 rounded-[10px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 max-md:hidden">
                <Search className="size-4 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => changeQuery(e.target.value)}
                  placeholder="Find a trader"
                  aria-label="Find a trader"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-text-3"
                />
                {query ? (
                  <button type="button" onClick={() => changeQuery("")} aria-label="Clear search" className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-surface-3 hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </label>
              {/* Phone: the column headers aren't there, so a Sort switch stands in for them. */}
              <div className="flex w-full items-center justify-between gap-3 md:hidden">
                <span className="text-sm text-text-3">Sort</span>
                <div className="flex items-center rounded-xl border border-border bg-card p-[3px]" role="group" aria-label="Sort by">
                  {(
                    [
                      ["combinedPercent", "Combined"],
                      ["actualizedUsd", "Actualized"],
                      ["closedTradeCount", "Trades"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={sortKey === key}
                      onClick={() => handleSort(key)}
                      className={cn("inline-flex h-9 items-center gap-1 rounded-[9px] px-3 text-[13px] font-medium transition-colors", sortKey === key ? "bg-surface-4 text-foreground" : "text-text-2")}
                    >
                      {label}
                      {sortKey === key ? sortDir === "asc" ? <ArrowUp className="size-3 text-primary" /> : <ArrowDown className="size-3 text-primary" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {tableEntries.length === 0 ? (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
                  <Search className="size-5" />
                </span>
                <b className="text-sm">{query ? <>No match for “{query}”</> : "No more traders to rank"}</b>
                {query ? (
                  <Button variant="outline" size="sm" onClick={() => changeQuery("")}>
                    Clear search
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                {/* Phone: one card per trader. */}
                <div className="flex flex-col gap-3 md:hidden">
                  {pagedEntries.map((entry) => {
                    const rank = rankByAddress.get(entry.address) ?? 0;
                    const isPending = pendingAddress === entry.address;
                    return (
                      <article key={entry.address} className="flex flex-col gap-3 rounded-[20px] border bg-card p-4" style={{ borderColor: rank === 1 ? "rgba(243,210,122,.45)" : undefined }}>
                        <div className="flex items-center gap-3">
                          <RankDisc rank={rank} disc />
                          <TraderAvatar address={entry.address} size="md" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <Link href={`/traders/${entry.address}`} target="_blank" rel="noopener noreferrer" className={cn("truncate text-[15px] font-semibold", !entry.label && "font-normal text-text-3")}>
                              {entry.label || "Unlabeled"}
                            </Link>
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-text-3">
                              {formatAddress(entry.address, 5)}
                              <CopyButton value={entry.address} label="address" className="size-5" />
                            </span>
                          </div>
                          <div className="flex flex-col items-end">
                            <b className={cn("text-[17px] font-semibold tabular-nums", toneText(entry.combinedPercent))}>{signedPercent(entry.combinedPercent)}</b>
                            <span className="text-xs text-text-3">combined</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3 text-xs text-text-3">
                          <span>
                            Actualized <b className={cn("font-semibold tabular-nums", toneText(entry.actualizedUsd))}>{signedUsd(entry.actualizedUsd)}</b>
                          </span>
                          <span>{entry.closedTradeCount} trades</span>
                          <StreakBadge streak={entry.streaks.currentStreak} short />
                        </div>
                        <Button variant="outline" disabled={isPending} onClick={() => setConfirmAddress(entry.address)} className="h-11 text-text-2">
                          {isPending ? <Loader2 className="animate-spin" /> : <Ban />}
                          Blacklist
                        </Button>
                      </article>
                    );
                  })}
                </div>
                <Pager page={currentPage} pageSize={PAGE_SIZE} total={tableEntries.length} onPage={setPage} className="rounded-2xl border bg-card md:hidden" />

                {/* Desktop: the table scrolls sideways inside its own box if the window is narrow. */}
                <div className="hidden md:block">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="w-[70px] pl-5 text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Rank</TableHead>
                        <TableHead className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Trader</TableHead>
                        <SortableHead label="Combined P&L" sortKey="combinedPercent" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                        <SortableHead label="Actualized P&L" sortKey="actualizedUsd" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                        <SortableHead label="Closed trades" sortKey="closedTradeCount" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                        <TableHead className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Current streak</TableHead>
                        <TableHead className="w-[130px] pr-5 text-right text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedEntries.map((entry) => {
                        const rank = rankByAddress.get(entry.address) ?? 0;
                        const isPending = pendingAddress === entry.address;
                        return (
                          <TableRow key={entry.address} className="group/row h-[60px] border-border">
                            <TableCell className="pl-5">
                              <RankDisc rank={rank} />
                            </TableCell>
                            <TableCell className="max-w-3xs sm:max-w-xs">
                              <div className="flex min-w-0 items-center gap-3">
                                <TraderAvatar address={entry.address} size="sm" />
                                <div className="flex min-w-0 flex-col gap-1">
                                  <span className={cn("truncate text-[13px] font-semibold", !entry.label && "font-normal text-text-3")}>{entry.label || "Unlabeled"}</span>
                                  <AddressChip address={entry.address} />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-[13px]">
                              <CombinedValue value={entry.combinedPercent} />
                            </TableCell>
                            <TableCell className={cn("text-right text-[13px] tabular-nums", toneText(entry.actualizedUsd))}>{signedUsd(entry.actualizedUsd)}</TableCell>
                            <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{entry.closedTradeCount}</TableCell>
                            <TableCell>
                              <StreakBadge streak={entry.streaks.currentStreak} />
                            </TableCell>
                            <TableCell className="pr-5 text-right">
                              <Button variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmAddress(entry.address)} className="text-text-2 hover:text-negative">
                                {isPending ? <Loader2 className="animate-spin" /> : <Ban />}
                                Blacklist
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <Pager page={currentPage} pageSize={PAGE_SIZE} total={tableEntries.length} onPage={setPage} className="max-md:hidden" />
              </>
            )}
          </div>
        </>
      )}

      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmAddress(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Blacklist this trader?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget ? formatAddress(confirmTarget.address, 6) : ""} will stop being tracked - no new trades will be recorded while blacklisted. All of their existing history stays visible under
              Blacklisted, and you can unblacklist them anytime to resume tracking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
              onClick={() => {
                if (confirmTarget) void handleBlacklist(confirmTarget.address);
                setConfirmAddress(null);
              }}
            >
              Blacklist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
