"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyButton } from "@/components/copy-button";
import { getBacktestMatchingAddresses, getBacktestRunTraders } from "@/lib/backtest-api";
import { formatAddress, formatUsd } from "@/lib/format";
import type { BacktestTraderFilter, BacktestTraderLimits, BacktestTraderQuery, BacktestTraderSort, BacktestTradersPage } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { ExportRunDialog } from "./export-run-dialog";
import { ProgressBar, StageBadge, formatDuration, formatSignedPercent, pnlTone, stageDescription } from "./shared";

type SortKey = BacktestTraderSort;
type Filter = BacktestTraderFilter;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "profitable", label: "Profitable" },
  { value: "losing", label: "Losing" },
  { value: "running", label: "In progress" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped / stopped early" },
];

const PAGE_SIZES = [25, 50, 100, 200];
const NO_LIMITS: BacktestTraderLimits = { minWinRate: "", minMargin: "", maxLossDays: "", minTrades: "", maxTrades: "", minAvgPnl: "", minPnl: "", minAvgPnlPerDay: "", minProfitDaysPercent: "", maxTotalLoss: "", holdsWithoutBest: false };
// A query slower than this gets the "working on it" notice with an estimate (faster ones just update).
const SLOW_AFTER_MS = 700;
// Until this view has been used once there is nothing measured to go on: roughly this long per address in the backtest.
const GUESS_MS_PER_ADDRESS = 0.012;

function SortHead({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

type Props = {
  runId: string;
  /** The backtest is being worked on: the page refreshes more often. */
  active: boolean;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (address: string) => void;
};

/**
 * The addresses of the run, a page at a time, with every way of narrowing them down in ONE panel: status, address search, and the "at least / at
 * most" limits - all combined, and all done by the server (the results of every address are stored on its row), so a backtest of hundreds of
 * thousands of addresses stays usable. A query that takes a moment says why and roughly how long. The same panel drives the CSV export.
 * Click a row to open the address's full page in a new tab.
 */
export function RunTradersTable({ runId, active, selected, onSelectedChange, onOpen }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "pnl", dir: "desc" });
  const [limits, setLimits] = useState<BacktestTraderLimits>(NO_LIMITS);
  const [appliedLimits, setAppliedLimits] = useState<BacktestTraderLimits>(NO_LIMITS); // the limits once typing has paused
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<BacktestTradersPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingSince, setPendingSince] = useState<number | null>(null); // a query YOU asked for is running
  const [now, setNow] = useState(() => Date.now());
  const [selectingAll, setSelectingAll] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const latest = useRef(0);
  const loadedOnce = useRef(false);
  const [tookByView, setTookByView] = useState<Record<string, number>>({}); // how long each kind of view took last time, ms
  const [runSize, setRunSize] = useState(0);
  const lastTookMs = useRef(0);

  // Typing in a limit or the search waits for a pause before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => setAppliedLimits(limits), 400);
    return () => clearTimeout(timer);
  }, [limits]);
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const query: BacktestTraderQuery = { filter, sort: sort.key, dir: sort.dir, page, limit: pageSize, limits: appliedLimits, search: appliedSearch };
  const queryKey = JSON.stringify(query);
  const viewKey = `${filter}|${sort.key}|${JSON.stringify(appliedLimits) === JSON.stringify(NO_LIMITS) ? 0 : 1}|${appliedSearch ? 1 : 0}`;

  const load = useCallback(
    async (silent: boolean) => {
      const mine = ++latest.current;
      const startedAt = Date.now();
      if (!silent) {
        setLoading(true);
        setPendingSince(startedAt);
      }
      try {
        const res = await getBacktestRunTraders(runId, JSON.parse(queryKey) as BacktestTraderQuery);
        if (mine !== latest.current) return; // a newer request has been made since
        loadedOnce.current = true;
        lastTookMs.current = res.tookMs ?? Date.now() - startedAt;
        setRunSize(res.runSize ?? res.counts.all);
        if (!silent) setTookByView((prev) => ({ ...prev, [viewKey]: Date.now() - startedAt }));
        setData(res);
        if (res.page > res.totalPages) setPage(res.totalPages); // the last page emptied out (a filter now matches fewer)
      } catch (e) {
        if (mine === latest.current && !loadedOnce.current) toast.error(e instanceof Error ? e.message : "Failed to load the addresses");
      } finally {
        if (mine === latest.current) {
          setLoading(false);
          setPendingSince(null);
        }
      }
    },
    [runId, queryKey, viewKey]
  );

  // Load now, then keep it fresh: every few seconds while the backtest runs - but never faster than a tenth of the time a refresh takes, so a
  // huge backtest is not asked the same slow question over and over.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async (first: boolean) => {
      await load(!first);
      if (cancelled) return;
      timer = setTimeout(() => loop(false), Math.max(active ? 5000 : 30000, lastTookMs.current * 10));
    };
    timer = setTimeout(() => loop(true), 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, active]);

  // While a query you asked for is running, keep the elapsed time on the notice moving.
  useEffect(() => {
    if (pendingSince === null) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [pendingSince]);

  const rows = data?.traders ?? [];
  const limitsActive = JSON.stringify(limits) !== JSON.stringify(NO_LIMITS);
  const anyFilter = filter !== "all" || limitsActive || search.trim() !== "";
  const pageAllSelected = rows.length > 0 && rows.every((t) => selected.has(t.address));
  const total = data?.total ?? 0;
  const canSelectAllMatching = pageAllSelected && total > rows.length && selected.size < total;

  const elapsed = pendingSince === null ? 0 : Math.max(0, now - pendingSince);
  const slow = pendingSince !== null && elapsed > SLOW_AFTER_MS;
  const known = tookByView[viewKey];
  const estimate = known ?? (runSize > 0 ? runSize * GUESS_MS_PER_ADDRESS : null);

  function changeFilter(next: Filter) {
    setFilter(next);
    setPage(1);
  }

  function clearAll() {
    setFilter("all");
    setLimits(NO_LIMITS);
    setSearch("");
    setPage(1);
  }

  function onSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
    setPage(1);
  }

  function togglePage() {
    const next = new Set(selected);
    if (pageAllSelected) rows.forEach((t) => next.delete(t.address));
    else rows.forEach((t) => next.add(t.address));
    onSelectedChange(next);
  }

  function toggleOne(address: string) {
    const next = new Set(selected);
    if (next.has(address)) next.delete(address);
    else next.add(address);
    onSelectedChange(next);
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const addresses = await getBacktestMatchingAddresses(runId, query);
      onSelectedChange(new Set([...selected, ...addresses]));
      if (addresses.length < total) toast.message(`Selected the first ${addresses.length.toLocaleString()} of ${total.toLocaleString()} - use the export to take them all.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to select the addresses");
    } finally {
      setSelectingAll(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Find an address (any part of it)"
              className="h-9 pl-8 font-mono text-xs"
            />
          </div>
          {anyFilter && (
            <Button size="sm" variant="ghost" onClick={clearAll}>
              Clear all filters
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setExportOpen(true)} disabled={data === null}>
            <Download className="size-4" /> Export CSV
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "outline"} onClick={() => changeFilter(f.value)}>
              {f.label} <span className="ml-1 text-xs opacity-70">{(data?.counts[f.value] ?? 0).toLocaleString()}</span>
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {(
            [
              ["minWinRate", "Win rate at least (%)"],
              ["minMargin", "Profit margin at least (%)"],
              ["maxLossDays", "Loss days at most"],
              ["minTrades", "Trades at least"],
              ["maxTrades", "Trades at most"],
              ["minAvgPnl", "Avg P&L per trade at least ($)"],
              ["minPnl", "Total P&L at least ($)"],
              ["minAvgPnlPerDay", "Avg P&L per day at least ($)"],
              ["minProfitDaysPercent", "Profitable days at least (%)"],
              ["maxTotalLoss", "Total loss at most ($)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {label}
              <Input
                inputMode="decimal"
                value={limits[key]}
                onChange={(e) => {
                  const value = e.target.value.replace(key === "minMargin" || key === "minAvgPnl" || key === "minPnl" || key === "minAvgPnlPerDay" ? /[^0-9.-]/g : /[^0-9.]/g, "");
                  setLimits((prev) => ({ ...prev, [key]: value }));
                  setPage(1);
                }}
                className="h-8 w-40"
              />
            </label>
          ))}
          <label className="flex items-center gap-2 pb-1.5 text-xs text-muted-foreground" title="Keep only traders that are still profitable after their single best day is removed">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={limits.holdsWithoutBest}
              onChange={(e) => {
                setLimits((prev) => ({ ...prev, holdsWithoutBest: e.target.checked }));
                setPage(1);
              }}
            />
            Still profitable without best day
          </label>
          <span className="ml-auto flex items-center gap-1.5 pb-1.5 text-xs text-muted-foreground">
            {loading && !slow && <Loader2 className="size-3 animate-spin" />}
            {total.toLocaleString()} of {(data?.counts.all ?? 0).toLocaleString()} match
          </span>
        </div>
        {data && (data.countsAgeMs ?? 0) > 15_000 && (
          <p className="text-[11px] text-muted-foreground">
            This backtest is big, so the numbers on the buttons above are refreshed less often - they are about {formatDuration(data.countsAgeMs)} old. The rows below are always current.
          </p>
        )}
      </div>

      {slow && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" />
            {runSize > 0 ? `Working through ${runSize.toLocaleString()} addresses…` : "Loading the addresses…"}
          </div>
          <p className="text-xs text-muted-foreground">
            Filtering and sorting are done on the server so your browser stays light, and a backtest this big takes a moment.{" "}
            {known != null
              ? `This view took about ${formatDuration(known)} last time.`
              : estimate != null
                ? `You have not used this view yet, so this is a rough estimate: about ${formatDuration(estimate)}.`
                : ""}
          </p>
          {estimate != null && <ProgressBar percent={Math.min(95, (elapsed / estimate) * 100)} className="h-1.5" />}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{formatDuration(elapsed)} so far</span>
            <span>{estimate != null && elapsed < estimate ? `about ${formatDuration(estimate - elapsed)} left` : "taking longer than usual - still working"}</span>
          </div>
        </div>
      )}

      {canSelectAllMatching && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>All {rows.length} on this page are selected.</span>
          <Button size="sm" variant="outline" disabled={selectingAll} onClick={selectAllMatching}>
            {selectingAll && <Loader2 className="size-4 animate-spin" />}
            Select all {total.toLocaleString()} that match
          </Button>
        </div>
      )}

      <div className={cn("overflow-x-auto rounded-xl border border-border/60 transition-opacity", slow && "opacity-50")}>
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <input type="checkbox" aria-label="Select this page" className="size-4 accent-primary" checked={pageAllSelected} onChange={togglePage} />
              </TableHead>
              <TableHead>Address &amp; progress</TableHead>
              <SortHead label="P&L" k="pnl" sort={sort} onSort={onSort} className="text-right" />
              <SortHead label="Combined" k="combined" sort={sort} onSort={onSort} className="hidden text-right md:table-cell" />
              <SortHead label="Avg P&L / trade" k="avgPnl" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
              <SortHead label="Avg P&L / day" k="avgPnlDay" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
              <SortHead label="Total loss" k="totalLoss" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
              <SortHead label="Win rate" k="winRate" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
              <SortHead label="Loss days" k="lossDays" sort={sort} onSort={onSort} className="hidden text-right xl:table-cell" />
              <SortHead label="Profitable days" k="profitDays" sort={sort} onSort={onSort} className="hidden text-right xl:table-cell" />
              <SortHead label="Profit margin" k="margin" sort={sort} onSort={onSort} className="hidden text-right xl:table-cell" />
              <SortHead label="Without best day" k="withoutBest" sort={sort} onSort={onSort} className="hidden text-right xl:table-cell" />
              <SortHead label="Trades" k="trades" sort={sort} onSort={onSort} className="hidden pr-4 text-right sm:table-cell" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13}className="py-10 text-center text-sm text-muted-foreground">
                  {data === null ? "Loading…" : "No address matches these filters."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const s = t.stats;
                const settled = t.stage === "done" || t.stage === "failed" || t.stage === "skipped";
                return (
                  <TableRow
                    key={t.address}
                    className="cursor-pointer border-border/60"
                    data-state={selected.has(t.address) ? "selected" : undefined}
                    onClick={() => onOpen(t.address)}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.address}`}
                        className="size-4 accent-primary"
                        checked={selected.has(t.address)}
                        onChange={() => toggleOne(t.address)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex w-40 min-w-0 flex-col gap-1.5 sm:w-auto sm:max-w-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs font-medium" title={t.address}>
                            {t.label || formatAddress(t.address, 6)}
                          </span>
                          <CopyButton value={t.address} />
                          {settled && <StageBadge stage={t.stage} />}
                        </div>
                        {!settled && (
                          <>
                            <ProgressBar percent={t.progressPercent} />
                            <span className="truncate text-[11px] text-muted-foreground">
                              {t.progressPercent.toFixed(0)}% · {stageDescription(t)}
                            </span>
                          </>
                        )}
                        {t.stage === "failed" && t.error && <span className="line-clamp-2 text-[11px] break-words whitespace-normal text-negative">{t.error}</span>}
                        {t.stage === "skipped" && t.error && <span className="line-clamp-2 text-[11px] break-words whitespace-normal text-amber-500">{t.error}</span>}
                        {t.stage === "done" && t.collect.signaturesFailed > 0 && (
                          <span className="text-[11px] break-words whitespace-normal text-amber-500">{t.collect.signaturesFailed} transaction(s) couldn&apos;t be fetched - results may be incomplete</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="flex flex-col gap-0.5">
                        <span className={cn("font-medium", pnlTone(s.realizedPnlUsd))}>{s.closed > 0 ? formatUsd(s.realizedPnlUsd) : "—"}</span>
                        <span className={cn("text-xs md:hidden", pnlTone(s.combinedPercent))}>{s.closed > 0 ? formatSignedPercent(s.combinedPercent, 0) : ""}</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn("hidden text-right tabular-nums md:table-cell", pnlTone(s.combinedPercent))}>
                      {s.closed > 0 ? formatSignedPercent(s.combinedPercent, 0) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell" title="Realized P&L divided by the closed trades">
                      {s.closed > 0 ? (
                        <div className="flex flex-col gap-0.5">
                          <span className={cn("font-medium", pnlTone(s.realizedPnlUsd))}>{formatUsd(s.realizedPnlUsd / s.closed)}</span>
                          {s.avgPercent != null && <span className={cn("text-[11px]", pnlTone(s.avgPercent))}>{formatSignedPercent(s.avgPercent)}</span>}
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className={cn("hidden text-right tabular-nums lg:table-cell", pnlTone(s.daily?.avgPnlPerDayUsd ?? 0))} title="Realized P&L divided by the days the trader traded">
                      {s.daily?.avgPnlPerDayUsd != null ? formatUsd(s.daily.avgPnlPerDayUsd) : "—"}
                    </TableCell>
                    <TableCell className={cn("hidden text-right tabular-nums lg:table-cell", (s.totalLossUsd ?? 0) > 0 && "text-negative")} title="Every losing trade added up">
                      {s.closed > 0 ? formatUsd(-(s.totalLossUsd ?? 0)) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">
                      {s.daily && s.daily.tradingDays > 0 ? (
                        <span className={s.daily.lossDays > 0 ? "text-negative" : undefined}>
                          {s.daily.lossDays}
                          <span className="text-xs text-muted-foreground"> / {s.daily.tradingDays}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell" title="Days that closed in a profit, out of the days the trader traded">
                      {s.daily?.profitDaysPercent != null ? (
                        <span>
                          {s.daily.profitDaysPercent.toFixed(0)}%
                          <span className="text-xs text-muted-foreground"> ({s.daily.profitDays}/{s.daily.tradingDays})</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className={cn("hidden text-right tabular-nums xl:table-cell", pnlTone(s.daily?.profitMarginPercent ?? 0))} title="How much of the profit is left after the losing days: (profit - loss) / profit">
                      {s.daily?.profitMarginPercent != null ? `${s.daily.profitMarginPercent.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">
                      {s.daily?.withoutBestDay ? (
                        <div className="flex flex-col gap-0.5" title={`Best day ${s.daily.bestDay?.date ?? ""} removed: ${formatUsd(s.daily.withoutBestDay.pnlUsd)}`}>
                          <span className={cn("font-medium", pnlTone(s.daily.withoutBestDay.combinedPercent))}>{formatSignedPercent(s.daily.withoutBestDay.combinedPercent, 0)}</span>
                          <span className={cn("text-[11px]", s.daily.withoutBestDay.stillProfitable ? "text-positive" : "text-negative")}>{s.daily.withoutBestDay.stillProfitable ? "still profit" : "turns loss"}</span>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="hidden pr-4 text-right tabular-nums sm:table-cell">
                      <div className="flex flex-col gap-0.5">
                        <span>{s.closed}</span>
                        {s.open > 0 && <span className="text-[11px] text-muted-foreground">+{s.open} open</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Page {data.page.toLocaleString()} of {data.totalPages.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            {PAGE_SIZES.map((n) => (
              <Button
                key={n}
                size="sm"
                variant={pageSize === n ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setPageSize(n);
                  setPage(1);
                }}
              >
                {n}
              </Button>
            ))}
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {exportOpen && <ExportRunDialog open onOpenChange={setExportOpen} runId={runId} query={query} matching={total} />}
    </div>
  );
}
