"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, EllipsisVertical, ListFilter, Loader2, Search, ShieldBan, SlidersHorizontal, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyButton } from "@/components/copy-button";
import { getBacktestMatchingAddresses, getBacktestRunTraders } from "@/lib/backtest-api";
import { formatAddress, formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
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
const NO_LIMITS: BacktestTraderLimits = { minWinRate: "", minMargin: "", maxLossDays: "", minTrades: "", maxTrades: "", minAvgPnl: "", minPnl: "", minAvgPnlPerDay: "", minProfitDaysPercent: "", maxTotalLoss: "", maxDayLossPercent: "", holdsWithoutBest: false };
// A query slower than this gets the "working on it" notice with an estimate (faster ones just update).
const SLOW_AFTER_MS = 700;
// Until this view has been used once there is nothing measured to go on: roughly this long per address in the backtest.
const GUESS_MS_PER_ADDRESS = 0.012;

type LimitKey = Exclude<keyof BacktestTraderLimits, "holdsWithoutBest">;
// [key, label in the popover, short label on the active chips and the phone sheet, symbol, may be negative]
const LIMIT_FIELDS: Array<[LimitKey, string, string, string, boolean]> = [
  ["minWinRate", "Win rate at least (%)", "Win rate", "≥ %", false],
  ["minMargin", "Profit margin at least (%)", "Profit margin", "≥ %", true],
  ["maxLossDays", "Loss days at most", "Loss days", "≤", false],
  ["minTrades", "Trades at least", "Trades", "≥", false],
  ["maxTrades", "Trades at most", "Trades", "≤", false],
  ["minAvgPnl", "Avg P&L per trade at least ($)", "Avg P&L / trade", "≥ $", true],
  ["minPnl", "Total P&L at least ($)", "Total P&L", "≥ $", true],
  ["minAvgPnlPerDay", "Avg P&L per day at least ($)", "Avg P&L / day", "≥ $", true],
  ["minProfitDaysPercent", "Profitable days at least (%)", "Profitable days", "≥ %", false],
  ["maxTotalLoss", "Total loss on trades at most ($)", "Total loss (trades)", "≤ $", false],
  ["maxDayLossPercent", "Total loss on days at most (%)", "Total loss (days)", "≤ %", false],
];

type ColumnKey = "combined" | "avgPnl" | "avgPnlDay" | "totalLoss" | "dayLoss" | "winRate" | "lossDays" | "profitDays" | "margin" | "withoutBest" | "trades";
const COLUMNS: Array<{ key: ColumnKey; label: string; sort?: SortKey }> = [
  { key: "combined", label: "Combined", sort: "combined" },
  { key: "avgPnl", label: "Avg P&L / trade", sort: "avgPnl" },
  { key: "avgPnlDay", label: "Avg P&L / day", sort: "avgPnlDay" },
  { key: "totalLoss", label: "Total loss (trades)", sort: "totalLoss" },
  { key: "dayLoss", label: "Total loss (days)", sort: "dayLoss" },
  { key: "winRate", label: "Win rate", sort: "winRate" },
  { key: "lossDays", label: "Loss days", sort: "lossDays" },
  { key: "profitDays", label: "Profitable days", sort: "profitDays" },
  { key: "margin", label: "Profit margin", sort: "margin" },
  { key: "withoutBest", label: "Without best day", sort: "withoutBest" },
  { key: "trades", label: "Trades", sort: "trades" },
];
const DEFAULT_HIDDEN: ColumnKey[] = ["totalLoss", "dayLoss"];
const COLUMNS_STORAGE_KEY = "backtest-run-hidden-columns";

function loadHiddenColumns(): Set<ColumnKey> {
  if (typeof window === "undefined") return new Set(DEFAULT_HIDDEN);
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return new Set(DEFAULT_HIDDEN);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_HIDDEN);
    return new Set(parsed.filter((k): k is ColumnKey => COLUMNS.some((c) => c.key === k)));
  } catch {
    return new Set(DEFAULT_HIDDEN);
  }
}

const num = (value: string) => value.replace(/[^0-9.-]/g, "");

function activeLimitChips(limits: BacktestTraderLimits): string[] {
  const chips: string[] = [];
  for (const [key, , short, symbol] of LIMIT_FIELDS) {
    const value = limits[key];
    if (value === "") continue;
    chips.push(symbol.includes("$") ? `${short} ${symbol.replace(" $", "")} $${value}` : `${short} ${symbol.replace(" %", "")} ${value}${symbol.includes("%") ? "%" : ""}`);
  }
  if (limits.holdsWithoutBest) chips.push("Still profitable without best day");
  return chips;
}

/** The 11 limits and the checkbox - the content of the Filters popover (wide screens) and of the Filters sheet (phones). */
function LimitsForm({ limits, onChange, columns }: { limits: BacktestTraderLimits; onChange: (next: BacktestTraderLimits) => void; columns: 1 | 2 }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className={cn("grid gap-3", columns === 2 ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
        {LIMIT_FIELDS.map(([key, label, short, symbol, negative]) => (
          <label key={key} className="flex min-w-0 flex-col gap-1 text-xs text-text-2">
            <span className="truncate">{columns === 2 ? `${short} ${symbol}` : label}</span>
            <Input
              inputMode="decimal"
              value={limits[key]}
              placeholder="—"
              onChange={(e) => onChange({ ...limits, [key]: negative ? num(e.target.value) : e.target.value.replace(/[^0-9.]/g, "") })}
              className="h-10 md:h-9"
            />
          </label>
        ))}
      </div>
      <label className="flex min-h-10 items-center gap-2.5 text-[13px]">
        <Checkbox checked={limits.holdsWithoutBest} onCheckedChange={(checked) => onChange({ ...limits, holdsWithoutBest: checked === true })} />
        <span>
          Still profitable without best day
          <HelpTip>Keep only traders still profitable without their best day.</HelpTip>
        </span>
      </label>
    </div>
  );
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : undefined}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.07em] uppercase transition-colors hover:text-foreground", active ? "text-foreground" : "text-text-3")}>
        {label}
        <Icon className={cn("size-3", active ? "text-primary" : "opacity-50")} />
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
  /** What to do with the ticked rows (the run page owns these dialogs). */
  onPromote?: () => void;
  onBlacklist?: () => void;
  onRemove?: () => void;
  busy?: boolean;
};

/**
 * The addresses of the run, a page at a time, with every way of narrowing them down in ONE panel: status, address search, and the "at least / at
 * most" limits - all combined, and all done by the server (the results of every address are stored on its row), so a backtest of hundreds of
 * thousands of addresses stays usable. A query that takes a moment says why and roughly how long. The same panel drives the CSV export.
 * Click a row to open the address's full page in a new tab.
 */
export function RunTradersTable({ runId, active, selected, onSelectedChange, onOpen, onPromote, onBlacklist, onRemove, busy }: Props) {
  const phone = !useMediaQuery("(min-width: 768px)");
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(() => loadHiddenColumns());
  const latest = useRef(0);
  const loadedOnce = useRef(false);
  const [tookByView, setTookByView] = useState<Record<string, number>>({}); // how long each kind of view took last time, ms
  const [runSize, setRunSize] = useState(0);
  const lastTookMs = useRef(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...hiddenColumns]));
    } catch {
      // blocked storage - the choice still holds for this visit
    }
  }, [hiddenColumns]);

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
  const limitChips = activeLimitChips(limits);
  const anyFilter = filter !== "all" || limitsActive || search.trim() !== "";
  const pageAllSelected = rows.length > 0 && rows.every((t) => selected.has(t.address));
  const total = data?.total ?? 0;
  const canSelectAllMatching = pageAllSelected && total > rows.length && selected.size < total;
  const show = (key: ColumnKey) => !hiddenColumns.has(key);

  const elapsed = pendingSince === null ? 0 : Math.max(0, now - pendingSince);
  const slow = pendingSince !== null && elapsed > SLOW_AFTER_MS;
  const known = tookByView[viewKey];
  const estimate = known ?? (runSize > 0 ? runSize * GUESS_MS_PER_ADDRESS : null);

  function changeFilter(next: Filter) {
    setFilter(next);
    setPage(1);
  }

  function changeLimits(next: BacktestTraderLimits) {
    setLimits(next);
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

  const filtersButton = (
    <Button variant="outline" className="gap-1.5 max-md:h-12 max-md:rounded-[14px]" onClick={phone ? () => setFiltersOpen(true) : undefined}>
      <ListFilter className="size-4" />
      Filters
      {limitChips.length > 0 ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-volt-line bg-volt-soft px-1 text-[10.5px] font-medium text-primary">{limitChips.length}</span> : null}
    </Button>
  );

  const columnsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <SlidersHorizontal className="size-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked disabled>
          Address &amp; progress
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked disabled>
          P&amp;L
        </DropdownMenuCheckboxItem>
        {COLUMNS.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={show(c.key)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) =>
              setHiddenColumns((prev) => {
                const next = new Set(prev);
                if (checked) next.delete(c.key);
                else next.add(c.key);
                return next;
              })
            }
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const matchLine = (
    <span className="flex items-center gap-1.5 text-xs text-text-3">
      {loading && !slow && <Loader2 className="size-3 animate-spin" />}
      {total.toLocaleString()} of {(data?.counts.all ?? 0).toLocaleString()} match
    </span>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:max-w-[340px] md:flex-none md:basis-[340px] md:rounded-[10px]">
          <Search className="size-4 shrink-0" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Find an address (any part of it)"
            aria-label="Find an address"
            className="min-w-0 flex-1 bg-transparent font-mono text-base text-foreground outline-none placeholder:font-sans placeholder:text-text-3 md:text-xs"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        {phone ? (
          filtersButton
        ) : (
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>{filtersButton}</PopoverTrigger>
            <PopoverContent align="start" className="flex w-[560px] max-w-[92vw] flex-col gap-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <b className="text-sm font-semibold">Filters</b>
                  <span className="text-xs text-text-3">
                    All combined, all done by the server · {limitChips.length} active · {total.toLocaleString()} of {(data?.counts.all ?? 0).toLocaleString()} match
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => changeLimits(NO_LIMITS)} disabled={!limitsActive}>
                  Clear all
                </Button>
              </div>
              <LimitsForm limits={limits} onChange={changeLimits} columns={1} />
            </PopoverContent>
          </Popover>
        )}
        <div className="max-md:hidden">{columnsMenu}</div>
        {anyFilter && (
          <Button variant="ghost" onClick={clearAll} className="max-md:hidden">
            Clear all filters
          </Button>
        )}
        <div className="hidden flex-1 md:block" />
        <Button variant="outline" className="gap-1.5 max-md:hidden" onClick={() => setExportOpen(true)} disabled={data === null}>
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      {/* Status chips with how many each holds */}
      <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 md:mx-0 md:w-auto md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <Chip key={f.value} active={filter === f.value} count={(data?.counts[f.value] ?? 0).toLocaleString()} onClick={() => changeFilter(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {/* Active limits and how many addresses match */}
      <div className="flex flex-wrap items-center gap-2">
        {limitChips.length > 0 && (
          <>
            <span className="text-xs text-text-3">Active:</span>
            {limitChips.map((chip) => (
              <span key={chip} className="inline-flex h-[22px] items-center rounded-full border border-line-2 bg-surface-3 px-2 text-[11.5px] whitespace-nowrap text-text-2">
                {chip}
              </span>
            ))}
          </>
        )}
        <span className="flex-1" />
        {matchLine}
      </div>
      {data && (data.countsAgeMs ?? 0) > 15_000 && (
        <p className="text-[11px] text-text-3">This backtest is big, so the numbers on the chips above are refreshed less often - they are about {formatDuration(data.countsAgeMs)} old. The rows below are always current.</p>
      )}

      {slow && (
        <div className="flex flex-col gap-2 rounded-[14px] border border-info/30 bg-info-soft p-3.5">
          <b className="flex items-center gap-2 text-[13px] font-semibold">
            <Loader2 className="size-4 animate-spin text-info" />
            {runSize > 0 ? `Working through ${runSize.toLocaleString()} addresses…` : "Loading the addresses…"}
          </b>
          <p className="text-[13px] text-text-2">
            Filtering and sorting are done on the server, and a backtest this big takes a moment.{" "}
            {known != null
              ? `This view took about ${formatDuration(known)} last time.`
              : estimate != null
                ? `You have not used this view yet, so this is a rough estimate: about ${formatDuration(estimate)}.`
                : ""}
          </p>
          {estimate != null && <ProgressBar percent={Math.min(95, (elapsed / estimate) * 100)} />}
          <div className="flex justify-between text-xs text-text-3">
            <span>{formatDuration(elapsed)} so far</span>
            <span>{estimate != null && elapsed < estimate ? `about ${formatDuration(estimate - elapsed)} left` : "taking longer than usual - still working"}</span>
          </div>
        </div>
      )}

      {/* What to do with the ticked rows */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-volt-line bg-volt-soft px-3.5 py-2.5 max-md:sticky max-md:bottom-[84px] max-md:z-20 max-md:bg-surface-3">
          <b className="text-[13px] font-semibold text-primary">{selected.size.toLocaleString()} selected</b>
          <span className="flex-1" />
          <Button size="sm" className="gap-1.5 max-md:h-10" disabled={busy} onClick={onPromote}>
            <UserPlus /> Add to live Traders
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative max-md:h-10" disabled={busy} onClick={onBlacklist}>
            <ShieldBan /> Blacklist
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative max-md:hidden" disabled={busy} onClick={onRemove}>
            <Trash2 /> Remove from backtest list
          </Button>
          {/* Phone: the rarer actions in a menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-lg" variant="outline" aria-label="More actions" className="md:hidden">
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem variant="destructive" className="min-h-10 gap-2.5" disabled={busy} onSelect={() => onRemove?.()}>
                <Trash2 className="size-4" /> Remove from backtest list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => onSelectedChange(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {canSelectAllMatching && (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-volt-line bg-volt-soft px-3.5 py-2.5 text-[13px]">
          <span>All {rows.length} on this page are selected.</span>
          <Button size="sm" variant="outline" disabled={selectingAll} onClick={selectAllMatching}>
            {selectingAll && <Loader2 className="animate-spin" />}
            Select all {total.toLocaleString()} that match
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center">
          <b className="text-sm font-semibold">{data === null ? "Loading…" : "No address matches these filters."}</b>
          {data !== null && anyFilter ? (
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear all filters
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* Phone: one card per address. */}
          <div className={cn("flex flex-col gap-3 md:hidden", slow && "opacity-50")}>
            <label className="flex min-h-10 items-center gap-2.5 px-1 text-[13px] text-text-2">
              <Checkbox checked={pageAllSelected ? true : rows.some((t) => selected.has(t.address)) ? "indeterminate" : false} onCheckedChange={togglePage} aria-label="Select this page" />
              Select this page
            </label>
            {rows.map((t) => {
              const s = t.stats;
              const settled = t.stage === "done" || t.stage === "failed" || t.stage === "skipped";
              const hasResults = s.closed > 0;
              return (
                <article key={t.address} className={cn("flex flex-col gap-3 rounded-[20px] border bg-card p-4", selected.has(t.address) ? "border-volt-line bg-volt-soft" : "border-border")}>
                  <div className="flex items-start gap-3">
                    <Checkbox className="mt-0.5" checked={selected.has(t.address)} onCheckedChange={() => toggleOne(t.address)} aria-label={`Select ${t.address}`} />
                    <button type="button" onClick={() => onOpen(t.address)} className="flex min-w-0 flex-1 flex-col gap-1.5 text-left">
                      <span className="flex flex-wrap items-center gap-2">
                        <b className="font-mono text-[13px] font-semibold">{t.label || formatAddress(t.address, 5)}</b>
                        <StageBadge stage={t.stage} />
                      </span>
                      {!settled && (
                        <>
                          <ProgressBar percent={t.progressPercent} />
                          <span className="text-xs text-text-3">
                            {t.progressPercent.toFixed(0)}% · {stageDescription(t)}
                          </span>
                        </>
                      )}
                      {t.stage === "failed" && t.error && <span className="text-xs break-words text-negative">{t.error}</span>}
                      {t.stage === "skipped" && t.error && <span className="text-xs break-words text-warn">{t.error}</span>}
                      {t.stage === "done" && t.collect.signaturesFailed > 0 && <span className="text-xs break-words text-warn">{t.collect.signaturesFailed} transaction(s) couldn&apos;t be fetched — results may be incomplete</span>}
                    </button>
                  </div>
                  {hasResults && (
                    <div className="grid grid-cols-4 gap-2">
                      <Kv label="P&L" value={formatUsd(s.realizedPnlUsd)} tone={pnlTone(s.realizedPnlUsd)} />
                      <Kv label="Comb." value={formatSignedPercent(s.combinedPercent, 0)} tone={pnlTone(s.combinedPercent)} />
                      <Kv label="Win" value={s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"} />
                      <Kv label="Trades" value={String(s.closed)} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Wide screens: the table scrolls sideways inside its own box. */}
          <div className={cn("overflow-hidden rounded-[20px] border border-border bg-card transition-opacity max-md:hidden", slow && "opacity-50")}>
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-11 pl-4">
                    <Checkbox checked={pageAllSelected ? true : rows.some((t) => selected.has(t.address)) ? "indeterminate" : false} onCheckedChange={togglePage} aria-label="Select this page" />
                  </TableHead>
                  <TableHead className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Address &amp; progress</TableHead>
                  <SortHead label="P&L" k="pnl" sort={sort} onSort={onSort} className="text-right" />
                  {COLUMNS.filter((c) => show(c.key)).map((c) => (
                    <SortHead key={c.key} label={c.label} k={c.sort as SortKey} sort={sort} onSort={onSort} className={cn("text-right", c.key === "trades" && "pr-4")} />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const s = t.stats;
                  const settled = t.stage === "done" || t.stage === "failed" || t.stage === "skipped";
                  const d = s.daily;
                  return (
                    <TableRow key={t.address} className="cursor-pointer border-border" data-state={selected.has(t.address) ? "selected" : undefined} onClick={() => onOpen(t.address)}>
                      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(t.address)} onCheckedChange={() => toggleOne(t.address)} aria-label={`Select ${t.address}`} />
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-sm min-w-0 flex-col gap-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-mono text-[13px] font-medium" title={t.address}>
                              {t.label || formatAddress(t.address, 6)}
                            </span>
                            <CopyButton value={t.address} />
                            <StageBadge stage={t.stage} />
                          </div>
                          {!settled && (
                            <>
                              <ProgressBar percent={t.progressPercent} />
                              <span className="truncate text-[11px] text-text-3">
                                {t.progressPercent.toFixed(0)}% · {stageDescription(t)}
                              </span>
                            </>
                          )}
                          {t.stage === "failed" && t.error && <span className="line-clamp-2 text-[11px] break-words whitespace-normal text-negative">{t.error}</span>}
                          {t.stage === "skipped" && t.error && <span className="line-clamp-2 text-[11px] break-words whitespace-normal text-warn">{t.error}</span>}
                          {t.stage === "done" && t.collect.signaturesFailed > 0 && (
                            <span className="text-[11px] break-words whitespace-normal text-warn">{t.collect.signaturesFailed} transaction(s) couldn&apos;t be fetched — results may be incomplete</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <b className={cn("font-semibold", pnlTone(s.realizedPnlUsd))}>{s.closed > 0 ? formatUsd(s.realizedPnlUsd) : <span className="font-normal text-text-3">—</span>}</b>
                      </TableCell>
                      {show("combined") && (
                        <TableCell className={cn("text-right text-[13px] tabular-nums", pnlTone(s.combinedPercent))}>{s.closed > 0 ? formatSignedPercent(s.combinedPercent, 0) : <span className="text-text-3">—</span>}</TableCell>
                      )}
                      {show("avgPnl") && (
                        <TableCell className="text-right text-[13px] tabular-nums" title="Realized P&L divided by the closed trades">
                          {s.closed > 0 ? (
                            <span className="inline-flex flex-col items-end leading-[1.3]">
                              <span className={pnlTone(s.realizedPnlUsd)}>{formatUsd(s.realizedPnlUsd / s.closed)}</span>
                              {s.avgPercent != null && <span className={cn("text-[11px]", pnlTone(s.avgPercent))}>{formatSignedPercent(s.avgPercent)}</span>}
                            </span>
                          ) : (
                            <span className="text-text-3">—</span>
                          )}
                        </TableCell>
                      )}
                      {show("avgPnlDay") && (
                        <TableCell className={cn("text-right text-[13px] tabular-nums", pnlTone(d?.avgPnlPerDayUsd ?? 0))} title="Realized P&L divided by the days the trader traded">
                          {d?.avgPnlPerDayUsd != null ? formatUsd(d.avgPnlPerDayUsd) : <span className="text-text-3">—</span>}
                        </TableCell>
                      )}
                      {show("totalLoss") && (
                        <TableCell className={cn("text-right text-[13px] tabular-nums", (s.totalLossUsd ?? 0) > 0 && "text-negative")} title="Every losing trade added up">
                          {s.closed > 0 ? formatUsd(-(s.totalLossUsd ?? 0)) : <span className="text-text-3">—</span>}
                        </TableCell>
                      )}
                      {show("dayLoss") && (
                        <TableCell className={cn("text-right text-[13px] tabular-nums", (d?.grossLossPercent ?? 0) > 0 && "text-negative")} title="The losing days added up (a day at -30% and another at -40% make -70%)">
                          {d && d.tradingDays > 0 ? formatSignedPercent(-d.grossLossPercent, 0) : <span className="text-text-3">—</span>}
                        </TableCell>
                      )}
                      {show("winRate") && <TableCell className="text-right text-[13px] tabular-nums">{s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : <span className="text-text-3">—</span>}</TableCell>}
                      {show("lossDays") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          {d && d.tradingDays > 0 ? (
                            <span className={d.lossDays > 0 ? "text-negative" : undefined}>
                              {d.lossDays}
                              <span className="text-xs text-text-3"> / {d.tradingDays}</span>
                            </span>
                          ) : (
                            <span className="text-text-3">—</span>
                          )}
                        </TableCell>
                      )}
                      {show("profitDays") && (
                        <TableCell className="text-right text-[13px] tabular-nums" title="Days that closed in a profit, out of the days the trader traded">
                          {d?.profitDaysPercent != null ? (
                            <span>
                              {d.profitDaysPercent.toFixed(0)}%
                              <span className="text-xs text-text-3"> ({d.profitDays}/{d.tradingDays})</span>
                            </span>
                          ) : (
                            <span className="text-text-3">—</span>
                          )}
                        </TableCell>
                      )}
                      {show("margin") && (
                        <TableCell className={cn("text-right text-[13px] tabular-nums", pnlTone(d?.profitMarginPercent ?? 0))} title="How much of the profit is left after the losing days: (profit - loss) / profit">
                          {d?.profitMarginPercent != null ? `${d.profitMarginPercent.toFixed(0)}%` : <span className="text-text-3">—</span>}
                        </TableCell>
                      )}
                      {show("withoutBest") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          {d?.withoutBestDay ? (
                            <span className="inline-flex flex-col items-end leading-[1.3]" title={`Best day ${d.bestDay?.date ?? ""} removed: ${formatUsd(d.withoutBestDay.pnlUsd)}`}>
                              <span className={pnlTone(d.withoutBestDay.combinedPercent)}>{formatSignedPercent(d.withoutBestDay.combinedPercent, 0)}</span>
                              <span className={cn("text-[11px]", d.withoutBestDay.stillProfitable ? "text-positive" : "text-negative")}>{d.withoutBestDay.stillProfitable ? "still profit" : "turns loss"}</span>
                            </span>
                          ) : (
                            <span className="text-text-3">—</span>
                          )}
                        </TableCell>
                      )}
                      {show("trades") && (
                        <TableCell className="pr-4 text-right text-[13px] tabular-nums">
                          <span className="inline-flex flex-col items-end leading-[1.3]">
                            <span>{s.closed}</span>
                            {s.open > 0 && <span className="text-[11px] text-text-3">+{s.open} open</span>}
                          </span>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-3">
          <span>
            Page {data.page.toLocaleString()} of {data.totalPages.toLocaleString()} · {rows.length} shown
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="max-md:hidden">Rows</span>
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
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 max-md:h-10" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 max-md:h-10" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Phone: the filters in a sheet, the export and column choices below the list. */}
      <Dialog open={phone && filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>All combined · done on the server</DialogDescription>
          </DialogHeader>
          <LimitsForm limits={limits} onChange={changeLimits} columns={2} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => changeLimits(NO_LIMITS)} disabled={!limitsActive}>
              Clear all
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Show {total.toLocaleString()} results</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="flex flex-wrap items-center gap-2 md:hidden">
        <Button variant="outline" className="h-11 flex-1 gap-1.5" onClick={() => setExportOpen(true)} disabled={data === null}>
          <Download className="size-4" /> Export CSV
        </Button>
        {anyFilter && (
          <Button variant="ghost" className="h-11" onClick={clearAll}>
            Clear all filters
          </Button>
        )}
      </div>

      {exportOpen && <ExportRunDialog open onOpenChange={setExportOpen} runId={runId} query={query} matching={total} />}
    </div>
  );
}

function Kv({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-text-3">{label}</span>
      <span className={cn("truncate text-[13px] font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}
