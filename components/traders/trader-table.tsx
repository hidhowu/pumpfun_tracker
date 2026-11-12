"use client";

import { CopyButton } from "@/components/copy-button";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Ban,
  Copy,
  EllipsisVertical,
  History,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Pager } from "@/components/ui/pager";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ManageListsMenu } from "./manage-lists-menu";
import { ManageWalletsMenu } from "./manage-wallets-menu";
import { TraderAvatar } from "./trader-avatar";
import { Sparkline } from "./sparkline";
import { BulkBar } from "./bulk-bar";
import type { Trader } from "@/lib/types";
import { copyText } from "@/lib/clipboard";
import { formatAddress, formatRelativeTime, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type TraderTableProps = {
  traders: Trader[];
  mode: "active" | "blacklisted";
  loading?: boolean;
  onBlacklistToggle: (address: string, blacklist: boolean) => Promise<void> | void;
  onMuteToggle: (address: string, muted: boolean | null) => Promise<void> | void;
  onListsChanged?: () => void;
  /** Blacklist every selected trader at once (the table asks for confirmation first). Omit to hide the bulk Blacklist button. */
  onBulkBlacklist?: (addresses: string[]) => Promise<void> | void;
  emptyMessage?: string;
  /** Extra controls for the toolbar, next to the search box (e.g. a list filter). */
  toolbar?: React.ReactNode;
};

type SortKey =
  | "address"
  | "activeTrades"
  | "dailyPnl"
  | "winRate"
  | "balance"
  | "value"
  | "combinedPnl"
  | "lastActive"
  | "lifetimeTrades"
  | "lifetimePnl";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortKey, string> = {
  address: "Trader",
  lifetimeTrades: "Lifetime trades",
  lifetimePnl: "Lifetime P&L",
  activeTrades: "Active trades",
  dailyPnl: "Daily P&L",
  winRate: "Daily win rate",
  balance: "Balance",
  value: "Value",
  combinedPnl: "Daily combined P&L",
  lastActive: "Last active",
};

const SORT_ACCESSORS: Record<SortKey, (t: Trader) => number | string> = {
  address: (t) => t.address.toLowerCase(),
  activeTrades: (t) => t.sim.openPositionCount,
  dailyPnl: (t) => t.today.actualizedUsd ?? -Infinity,
  winRate: (t) => t.today.winRatePercent ?? -Infinity,
  balance: (t) => t.sim.balanceUsd,
  value: (t) => t.walletValueUsd,
  combinedPnl: (t) => (t.today.closedTradeCount > 0 ? t.today.combinedPercent : -Infinity),
  lastActive: (t) => (t.sim.lastActionAt ? new Date(t.sim.lastActionAt).getTime() : -Infinity),
  // OUR simulated copy-trade lifetime stats - never the tracked wallet's own
  // on-chain activity, which this app only ever uses as a buy/sell signal,
  // never for any calculation shown in the UI.
  lifetimeTrades: (t) => t.sim.closedPositionCount + t.sim.openPositionCount,
  lifetimePnl: (t) => t.sim.realizedPnlUsd,
};

// Every column except Trader (always frozen/first) and Action (always last)
// can be hidden via the Columns toggle - see visibleColumns state below.
// "Trader" and "Action" are deliberately excluded from this list: hiding
// trader identity or the row actions would make the table useless, so
// they're never optional.
type ColumnKey =
  | "lifetimeTrades"
  | "lifetimePnl"
  | "activeTrades"
  | "dailyPnl"
  | "winRate"
  | "balance"
  | "value"
  | "combinedPnl"
  | "lastActive"
  | "note"
  | "notify";

const COLUMN_DEFS: { key: ColumnKey; label: string; only?: "active" | "blacklisted" }[] = [
  { key: "lifetimeTrades", label: "Lifetime Trades" },
  { key: "lifetimePnl", label: "Lifetime PnL" },
  { key: "activeTrades", label: "Active Trades" },
  { key: "dailyPnl", label: "Daily PnL" },
  { key: "winRate", label: "Daily Win Rate" },
  { key: "balance", label: "Balance" },
  { key: "value", label: "Value" },
  { key: "combinedPnl", label: "Daily Combined PnL" },
  { key: "lastActive", label: "Last Active" },
  { key: "note", label: "Note", only: "blacklisted" },
  { key: "notify", label: "Notify" },
];

const VISIBLE_COLUMNS_STORAGE_KEY = "trader-table-hidden-columns";

function loadHiddenColumns(): Set<ColumnKey> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is ColumnKey => COLUMN_DEFS.some((c) => c.key === k)));
  } catch {
    return new Set(); // private-mode/blocked storage etc. - just fall back to "show everything"
  }
}

// Sticky cells need an explicit opaque background so rows scrolling
// underneath (both vertically under the header, and horizontally under the
// frozen first column) don't show through.
const PAGE_SIZE = 10;
const STICKY_HEAD = "bg-card";
const STICKY_CHECK_HEAD = "sticky left-0 z-20 w-11 min-w-11 bg-card pr-0 pl-4";
const STICKY_CHECK_CELL = "sticky left-0 z-10 w-11 min-w-11 bg-card pr-0 pl-4 group-hover/row:bg-surface-2 group-data-[state=selected]/row:bg-[#222e19]";
const STICKY_FIRST_HEAD = "sticky left-11 z-20 bg-card";
const STICKY_FIRST_CELL = "sticky left-11 z-10 bg-card group-hover/row:bg-surface-2 group-data-[state=selected]/row:bg-[#222e19]";
const STICKY_LAST_HEAD = "sticky right-0 z-20 bg-card";
const STICKY_LAST_CELL = "sticky right-0 z-10 bg-card group-hover/row:bg-surface-2 group-data-[state=selected]/row:bg-[#222e19]";

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = activeKey === sortKey;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={cn(STICKY_HEAD, align === "right" && "text-right")} aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.07em] uppercase transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          isActive ? "text-foreground" : "text-text-3"
        )}
      >
        {label}
        <Icon className={cn("size-3", isActive ? "text-primary" : "opacity-50")} />
      </button>
    </TableHead>
  );
}

function PnlValue({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className="text-text-3">-</span>;
  return <b className={cn("font-semibold", value > 0 && "text-positive", value < 0 && "text-negative", value === 0 && "text-text-3", className)}>{formatUsd(value)}</b>;
}

function WinBar({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  if (total === 0) return null;
  return (
    <span className="flex h-1.5 w-[84px] gap-0.5 overflow-hidden rounded-full" aria-hidden>
      <i className="block h-full bg-positive" style={{ width: `${(wins / total) * 100}%` }} />
      <i className="block h-full bg-negative" style={{ width: `${(losses / total) * 100}%` }} />
    </span>
  );
}

function ColumnsToggle({
  hidden,
  onToggle,
  columns,
}: {
  hidden: Set<ColumnKey>;
  onToggle: (key: ColumnKey, visible: boolean) => void;
  columns: typeof COLUMN_DEFS;
}) {
  const hiddenCount = columns.filter((c) => hidden.has(c.key)).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="size-3.5" />
          Columns
          {hiddenCount > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-[18px] px-1.5 text-[10px] font-normal">
              {hiddenCount} hidden
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={!hidden.has(col.key)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => onToggle(col.key, checked)}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TraderTable({
  traders,
  mode,
  loading,
  onBlacklistToggle,
  onMuteToggle,
  onListsChanged,
  onBulkBlacklist,
  emptyMessage,
  toolbar,
}: TraderTableProps) {
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  // Best lifetime P&L first, as in the design; clicking a column header changes it.
  const [sortKey, setSortKey] = useState<SortKey | null>("lifetimePnl");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  // Ticked rows (desktop table) - the bulk bar acts on these.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The trader whose "Blacklist" confirmation is open (one dialog for the whole table).
  const [confirmBlacklist, setConfirmBlacklist] = useState<string | null>(null);
  const [confirmBulkBlacklist, setConfirmBulkBlacklist] = useState(false);
  // Lazy-initialized from localStorage so a column choice persists across
  // visits - a per-viewer convenience, never anything read back by the
  // server or relied on for correctness.
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnKey>>(() => loadHiddenColumns());

  useEffect(() => {
    try {
      window.localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify([...hiddenColumns]));
    } catch {
      // private-mode/blocked storage - the toggle still works for this session, just doesn't persist
    }
  }, [hiddenColumns]);

  function toggleColumn(key: ColumnKey, visible: boolean) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(key);
      else next.add(key);
      return next;
    });
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
      // Address reads naturally A-Z first; every numeric column reads
      // naturally highest-first (biggest profit/value on top).
      setSortDir(key === "address" ? "asc" : "desc");
    }
  }

  const visibleTraders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return traders;
    return traders.filter((t) => t.address.toLowerCase().includes(q) || (t.label ?? "").toLowerCase().includes(q));
  }, [traders, query]);

  const sortedTraders = useMemo(() => {
    if (!sortKey) return visibleTraders;
    const accessor = SORT_ACCESSORS[sortKey];
    const sorted = [...visibleTraders].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [visibleTraders, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sortedTraders.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedTraders = useMemo(() => sortedTraders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [sortedTraders, currentPage]);

  // Only traders still in the list count as selected (a blacklisted or removed one drops out by itself).
  const selectedAddresses = useMemo(() => traders.filter((t) => selected.has(t.address)).map((t) => t.address), [traders, selected]);
  const pageAddresses = pagedTraders.map((t) => t.address);
  const pageSelectedCount = pageAddresses.filter((a) => selected.has(a)).length;
  const allPageSelected = pageAddresses.length > 0 && pageSelectedCount === pageAddresses.length;

  function toggleSelected(address: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(address);
      else next.delete(address);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const a of pageAddresses) {
        if (checked) next.add(a);
        else next.delete(a);
      }
      return next;
    });
  }

  async function handleBlacklistToggle(address: string, blacklist: boolean) {
    setPendingAddress(address);
    try {
      await onBlacklistToggle(address, blacklist);
    } finally {
      setPendingAddress(null);
    }
  }

  async function handleMuteToggle(address: string, checked: boolean) {
    setPendingAddress(address);
    try {
      // Flipping the switch always sets an explicit override (not back to
      // "inherit default") - clearing an override is a separate action we
      // don't expose in the table (kept in scope: this is the toggle asked for).
      await onMuteToggle(address, !checked);
    } finally {
      setPendingAddress(null);
    }
  }

  async function copyAddress(address: string) {
    if (await copyText(address)) toast.success("Address copied");
    else toast.error("Could not copy address");
  }

  // The blacklisted view: faded avatars, a Note column, a visible Unblacklist button, and no row ticking / sparklines.
  const blacklisted = mode === "blacklisted";
  const columnDefs = COLUMN_DEFS.filter((c) => !c.only || c.only === mode);
  const show = (key: ColumnKey) => columnDefs.some((c) => c.key === key) && !hiddenColumns.has(key);
  const visibleColumnCount = 2 + columnDefs.filter((c) => show(c.key)).length + (blacklisted ? 0 : 1); // Trader + Action always shown, + the tick box column
  const firstHead = blacklisted ? "sticky left-0 z-20 bg-card pl-5" : STICKY_FIRST_HEAD;
  const firstCell = blacklisted ? "sticky left-0 z-10 bg-card pl-5 group-hover/row:bg-surface-2" : STICKY_FIRST_CELL;
  const sortSummary = sortKey ? `${SORT_LABELS[sortKey]} ${sortDir === "asc" ? "↑" : "↓"}` : null;

  if (!loading && traders.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {toolbar ? <div className="flex flex-wrap items-center gap-3">{toolbar}</div> : null}
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            {mode === "blacklisted" ? <Ban className="size-6" /> : <Users className="size-6" />}
          </span>
          <b className="text-[15px] font-semibold">{emptyMessage ?? "No traders here yet."}</b>
        </div>
      </div>
    );
  }

  const blacklistTarget = confirmBlacklist ? traders.find((t) => t.address === confirmBlacklist) : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-card max-md:border-0 max-md:bg-transparent">
      {/* Toolbar: search, the page's own filter(s), count, sort and columns. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-3 max-md:border-0 max-md:p-0 max-md:pb-3 md:px-4">
        <label className={cn("flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:max-w-[340px] md:rounded-[10px]", blacklisted && "hidden")}>
          <Search className="size-4 shrink-0" />
          <input
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            placeholder="Search label or address"
            aria-label="Search traders"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]"
          />
          {query ? (
            <button type="button" onClick={() => changeQuery("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        {toolbar}
        <div className="hidden flex-1 md:block" />
        {blacklisted ? (
          <span className="hidden text-sm text-text-2 md:inline">
            {query ? `${visibleTraders.length} of ${traders.length}` : traders.length} blacklisted trader{traders.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {sortSummary && !blacklisted ? <span className="hidden text-xs text-text-3 md:inline">Sorted by {sortSummary}</span> : null}
        <div className="hidden md:block">
          <ColumnsToggle hidden={hiddenColumns} onToggle={toggleColumn} columns={columnDefs} />
        </div>
        {/* Phone: the count on the left, a Sort menu on the right (the table's column headers aren't there). */}
        <div className="flex w-full items-center justify-between md:hidden">
          <span className="text-sm text-text-2">
            {query ? `${visibleTraders.length} of ${traders.length}` : traders.length} {blacklisted ? "blacklisted " : ""}trader{traders.length === 1 ? "" : "s"}
            {sortSummary ? ` · ${sortSummary}` : ""}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <ArrowUpDown className="size-3.5" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <DropdownMenuItem key={key} onSelect={() => handleSort(key)} className="min-h-10 justify-between">
                  {SORT_LABELS[key]}
                  {sortKey === key ? (
                    <span className="flex items-center gap-1 text-primary">
                      {sortDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!blacklisted && selectedAddresses.length > 0 ? (
        <div className="max-md:hidden">
          <BulkBar
            addresses={selectedAddresses}
            onClear={() => setSelected(new Set())}
            onListsChanged={onListsChanged}
            onBlacklist={onBulkBlacklist ? () => setConfirmBulkBlacklist(true) : undefined}
          />
        </div>
      ) : null}

      {!loading && visibleTraders.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <Search className="size-5" />
          </span>
          <b className="text-sm">No match for “{query}”</b>
          <span className="text-xs text-text-3">Clear the search or the list filter.</span>
          <Button variant="outline" size="sm" onClick={() => changeQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <>
          {/* Phone: one card per trader. */}
          <div className="flex flex-col gap-3 md:hidden">
            {loading &&
              traders.length === 0 &&
              Array.from({ length: 3 }).map((_, i) => (
                <div key={`m-skeleton-${i}`} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <div className="size-12 animate-pulse rounded-[15px] bg-surface-3" />
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="h-3.5 w-3/5 animate-pulse rounded bg-surface-3" />
                      <div className="h-3 w-2/5 animate-pulse rounded bg-surface-3" />
                    </div>
                  </div>
                  <div className="h-11 animate-pulse rounded bg-surface-3" />
                </div>
              ))}
            {pagedTraders.map((trader) => {
              const isPending = pendingAddress === trader.address;
              const today = trader.today;
              const hasClosedToday = today.closedTradeCount > 0;
              const pnl = trader.sim.realizedPnlUsd;
              return (
                <article key={trader._id} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <TraderAvatar address={trader.address} size="lg" className={cn(blacklisted && "opacity-60")} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link href={`/traders/${trader.address}`} target="_blank" rel="noopener noreferrer" className={cn("truncate text-[15px] font-semibold", !trader.label && "font-normal text-text-3")}>
                        {trader.label || "Unlabeled"}
                      </Link>
                      <span className="inline-flex h-[26px] w-fit items-center gap-1.5 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2">
                        {formatAddress(trader.address, 5)}
                        <CopyButton value={trader.address} label="address" className="size-5" />
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <PnlValue value={pnl} className="text-lg tabular-nums" />
                      <span className="text-xs text-text-3">lifetime P&amp;L</span>
                    </div>
                  </div>
                  {blacklisted ? (
                    <div className="grid grid-cols-3 gap-x-3 border-y border-border py-3">
                      <Kv label="Trades" value={trader.sim.closedPositionCount + trader.sim.openPositionCount} />
                      <Kv label="Balance" value={formatUsd(trader.sim.balanceUsd)} />
                      <Kv label="Last active" value={formatRelativeTime(trader.sim.lastActionAt)} />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-x-3 gap-y-3 border-y border-border py-3">
                      <Kv label="Today" value={<PnlValue value={today.actualizedUsd} />} />
                      <Kv label="Win rate" value={hasClosedToday && today.winRatePercent !== null ? `${today.winRatePercent.toFixed(0)}%` : "-"} />
                      <Kv label="Open" value={trader.sim.openPositionCount} />
                      <Kv label="Lifetime trades" value={trader.sim.closedPositionCount + trader.sim.openPositionCount} />
                      <Kv
                        label="Daily combined"
                        value={
                          hasClosedToday ? (
                            <span className={cn(today.combinedPercent > 0 && "text-positive", today.combinedPercent < 0 && "text-negative")}>
                              {today.combinedPercent >= 0 ? "+" : ""}
                              {today.combinedPercent.toFixed(1)}%
                            </span>
                          ) : (
                            "-"
                          )
                        }
                      />
                      <Kv label="Last active" value={formatRelativeTime(trader.sim.lastActionAt)} />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex min-h-11 items-center gap-2.5 text-sm text-text-2">
                      <Switch checked={!trader.muted} disabled={isPending} onCheckedChange={(checked) => handleMuteToggle(trader.address, checked)} aria-label="Toggle notifications" />
                      Notify
                      <Badge variant="secondary" className="h-[18px] px-1.5 text-[10px] font-normal">
                        {trader.mutedOverride === null ? "default" : "custom"}
                      </Badge>
                    </label>
                    <div className="flex items-center gap-1">
                      <ManageListsMenu traderAddress={trader.address} currentListIds={trader.listIds} onChanged={() => onListsChanged?.()} triggerClassName="size-11 rounded-xl border border-line-2" />
                      <ManageWalletsMenu traderAddress={trader.address} triggerClassName="size-11 rounded-xl border border-line-2" />
                      {blacklisted ? null : (
                        <RowMenu trader={trader} mode={mode} disabled={isPending} onCopy={copyAddress} onBlacklist={setConfirmBlacklist} onUnblacklist={(a) => handleBlacklistToggle(a, false)} className="size-11 rounded-xl border border-line-2" />
                      )}
                    </div>
                  </div>
                  {blacklisted ? (
                    <Button variant="outline" className="h-12 gap-2" disabled={isPending} onClick={() => void handleBlacklistToggle(trader.address, false)}>
                      {isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                      Unblacklist
                    </Button>
                  ) : null}
                </article>
              );
            })}
          </div>

          <Pager page={currentPage} pageSize={PAGE_SIZE} total={sortedTraders.length} onPage={setPage} className="rounded-2xl border bg-card md:hidden" />

          {/* Desktop: the table scrolls sideways inside its own box (the Table wrapper); the select, trader and action columns stay put. */}
          <div className="hidden md:block">
            <Table className="min-w-[1560px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  {blacklisted ? null : (
                    <TableHead className={STICKY_CHECK_HEAD}>
                      <Checkbox
                        checked={allPageSelected ? true : pageSelectedCount > 0 ? "indeterminate" : false}
                        onCheckedChange={(checked) => togglePage(checked === true)}
                        aria-label={allPageSelected ? "Deselect all traders on this page" : "Select all traders on this page"}
                      />
                    </TableHead>
                  )}
                  <TableHead className={cn(firstHead, "min-w-[260px]", !blacklisted && "pl-1")} aria-sort={sortKey === "address" ? (sortDir === "asc" ? "ascending" : "descending") : undefined}>
                    <button
                      type="button"
                      onClick={() => handleSort("address")}
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.07em] uppercase transition-colors hover:text-foreground",
                        sortKey === "address" ? "text-foreground" : "text-text-3"
                      )}
                    >
                      Trader
                      {sortKey === "address" ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="size-3 text-primary" />
                        ) : (
                          <ArrowDown className="size-3 text-primary" />
                        )
                      ) : (
                        <ArrowUpDown className="size-3 opacity-50" />
                      )}
                    </button>
                  </TableHead>
                  {show("lifetimeTrades") && <SortableHead label="Lifetime Trades" sortKey="lifetimeTrades" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("lifetimePnl") && <SortableHead label="Lifetime PnL" sortKey="lifetimePnl" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("activeTrades") && <SortableHead label="Active Trades" sortKey="activeTrades" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("dailyPnl") && <SortableHead label="Daily PnL (Actualized)" sortKey="dailyPnl" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("winRate") && <SortableHead label="Daily Win Rate" sortKey="winRate" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("balance") && <SortableHead label="Balance" sortKey="balance" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("value") && <SortableHead label="Value" sortKey="value" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("combinedPnl") && <SortableHead label="Daily Combined PnL" sortKey="combinedPnl" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("lastActive") && <SortableHead label="Last Active" sortKey="lastActive" activeKey={sortKey} dir={sortDir} onSort={handleSort} />}
                  {show("note") && <TableHead className={cn(STICKY_HEAD, "min-w-[200px]")}>Note</TableHead>}
                  {show("notify") && <TableHead className={cn(STICKY_HEAD, "text-center")}>Notify</TableHead>}
                  <TableHead className={cn(STICKY_LAST_HEAD, "pr-5 text-right", blacklisted ? "w-[220px]" : "w-[130px]")}>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading &&
                  traders.length === 0 &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`} className="border-border">
                      <TableCell colSpan={visibleColumnCount} className="h-14">
                        <div className="h-4 w-full animate-pulse rounded bg-surface-3" />
                      </TableCell>
                    </TableRow>
                  ))}

                {pagedTraders.map((trader) => {
                  const isPending = pendingAddress === trader.address;
                  const today = trader.today;
                  const hasClosedToday = today.closedTradeCount > 0;
                  const combinedPositive = hasClosedToday && today.combinedPercent > 0;
                  const combinedNegative = hasClosedToday && today.combinedPercent < 0;

                  return (
                    <TableRow key={trader._id} className="group/row h-[60px] border-border" data-state={selected.has(trader.address) ? "selected" : undefined}>
                      {blacklisted ? null : (
                        <TableCell className={STICKY_CHECK_CELL}>
                          <Checkbox checked={selected.has(trader.address)} onCheckedChange={(checked) => toggleSelected(trader.address, checked === true)} aria-label={`Select ${trader.label || formatAddress(trader.address, 5)}`} />
                        </TableCell>
                      )}
                      <TableCell className={cn(firstCell, "max-w-3xs sm:max-w-xs", !blacklisted && "pl-1")}>
                        <div className="flex min-w-0 items-center gap-3">
                          <TraderAvatar address={trader.address} className={cn(blacklisted && "opacity-60")} />
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className={cn("truncate text-[13px] font-semibold", !trader.label && "font-normal text-text-3")}>{trader.label || "Unlabeled"}</span>
                            <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
                              <Link href={`/traders/${trader.address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                                {formatAddress(trader.address, 5)}
                                <ArrowUpRight className="size-3" />
                              </Link>
                              <CopyButton value={trader.address} label="address" />
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      {show("lifetimeTrades") && (
                        <TableCell className="text-right text-[13px] text-text-2 tabular-nums">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <History className="size-3.5 text-text-3" />
                            {trader.sim.closedPositionCount + trader.sim.openPositionCount}
                          </span>
                        </TableCell>
                      )}

                      {show("lifetimePnl") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          <div className="flex items-center justify-end gap-3">
                            {blacklisted ? null : <Sparkline values={trader.pnlSpark} tone={trader.sim.realizedPnlUsd > 0 ? "positive" : trader.sim.realizedPnlUsd < 0 ? "negative" : "flat"} />}
                            <PnlValue value={trader.sim.realizedPnlUsd} className="inline-block min-w-[76px] text-right" />
                          </div>
                        </TableCell>
                      )}

                      {show("activeTrades") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <Layers className="size-3.5 text-text-3" />
                            {trader.sim.openPositionCount}
                          </span>
                        </TableCell>
                      )}

                      {show("dailyPnl") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          <PnlValue value={today.actualizedUsd} />
                        </TableCell>
                      )}

                      {show("winRate") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          {!hasClosedToday ? (
                            <span className="text-text-3">-</span>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-end gap-2">
                                  <WinBar wins={today.wins} losses={today.losses} />
                                  {today.winRatePercent === null ? "-" : `${today.winRatePercent.toFixed(0)}%`}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {today.wins}W / {today.losses}L today
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      )}

                      {show("balance") && <TableCell className="text-right text-[13px] tabular-nums">{formatUsd(trader.sim.balanceUsd)}</TableCell>}

                      {show("value") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>{formatUsd(trader.walletValueUsd)}</span>
                            </TooltipTrigger>
                            <TooltipContent>Balance + current value of open positions</TooltipContent>
                          </Tooltip>
                        </TableCell>
                      )}

                      {show("combinedPnl") && (
                        <TableCell className="text-right text-[13px] tabular-nums">
                          {!hasClosedToday ? (
                            <span className="text-text-3">-</span>
                          ) : (
                            <b className={cn("font-semibold", combinedPositive && "text-positive", combinedNegative && "text-negative", !combinedPositive && !combinedNegative && "text-text-3")}>
                              {today.combinedPercent >= 0 ? "+" : ""}
                              {today.combinedPercent.toFixed(1)}%
                            </b>
                          )}
                        </TableCell>
                      )}

                      {show("lastActive") && <TableCell className="text-right text-[13px] text-text-3">{formatRelativeTime(trader.sim.lastActionAt)}</TableCell>}

                      {show("note") && (
                        <TableCell className="max-w-[240px] truncate text-[13px] text-text-3" title={trader.notes || undefined}>
                          {trader.notes || "—"}
                        </TableCell>
                      )}

                      {show("notify") && (
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            <Switch checked={!trader.muted} disabled={isPending} onCheckedChange={(checked) => handleMuteToggle(trader.address, checked)} aria-label="Toggle notifications" />
                            {trader.mutedOverride === null ? (
                              <Badge variant="secondary" className="h-[18px] px-1.5 text-[10px] font-normal">
                                default
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                      )}

                      <TableCell className={cn(STICKY_LAST_CELL, "pr-5 text-right")}>
                        <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                          <ManageListsMenu traderAddress={trader.address} currentListIds={trader.listIds} onChanged={() => onListsChanged?.()} />
                          <ManageWalletsMenu traderAddress={trader.address} />
                          {blacklisted ? (
                            <Button variant="ghost" size="sm" disabled={isPending} onClick={() => void handleBlacklistToggle(trader.address, false)} className="ml-1 gap-1.5 text-text-2 hover:text-positive">
                              {isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                              Unblacklist
                            </Button>
                          ) : (
                            <RowMenu trader={trader} mode={mode} disabled={isPending} onCopy={copyAddress} onBlacklist={setConfirmBlacklist} onUnblacklist={(a) => handleBlacklistToggle(a, false)} />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pager page={currentPage} pageSize={PAGE_SIZE} total={sortedTraders.length} onPage={setPage} className="max-md:hidden" />
        </>
      )}

      <AlertDialog open={!!blacklistTarget} onOpenChange={(open) => !open && setConfirmBlacklist(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Blacklist this trader?</AlertDialogTitle>
            <AlertDialogDescription>
              {blacklistTarget ? formatAddress(blacklistTarget.address, 6) : ""} will stop being tracked - no new trades will be recorded while blacklisted. All of their existing history stays visible under
              Blacklisted, and you can unblacklist them anytime to resume tracking.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
              onClick={() => {
                if (blacklistTarget) void handleBlacklistToggle(blacklistTarget.address, true);
                setConfirmBlacklist(null);
              }}
            >
              Blacklist
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBulkBlacklist} onOpenChange={setConfirmBulkBlacklist}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Blacklist {selectedAddresses.length} trader{selectedAddresses.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will stop being tracked - no new trades are recorded while blacklisted. Their history stays visible under Blacklisted, and you can unblacklist them anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
              onClick={() => {
                void onBulkBlacklist?.(selectedAddresses);
                setSelected(new Set());
                setConfirmBulkBlacklist(false);
              }}
            >
              Blacklist {selectedAddresses.length}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11.5px] text-text-3">{label}</span>
      <span className="truncate text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** The "⋯" menu at the end of a row: open the trader's page, copy the address, and (un)blacklist. */
function RowMenu({
  trader,
  mode,
  disabled,
  onCopy,
  onBlacklist,
  onUnblacklist,
  className,
}: {
  trader: Trader;
  mode: "active" | "blacklisted";
  disabled: boolean;
  onCopy: (address: string) => void;
  onBlacklist: (address: string) => void;
  onUnblacklist: (address: string) => void;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("text-text-2", className)} aria-label="More actions" disabled={disabled}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild className="min-h-9 gap-2.5">
          <Link href={`/traders/${trader.address}`} target="_blank" rel="noopener noreferrer">
            <ArrowUpRight className="size-4" /> Open in new tab
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy(trader.address)} className="min-h-9 gap-2.5">
          <Copy className="size-4" /> Copy address
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {mode === "active" ? (
          <DropdownMenuItem variant="destructive" onSelect={() => onBlacklist(trader.address)} className="min-h-9 gap-2.5">
            <Ban className="size-4" /> Blacklist trader…
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onUnblacklist(trader.address)} className="min-h-9 gap-2.5 text-positive focus:text-positive">
            <ShieldCheck className="size-4" /> Unblacklist
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
