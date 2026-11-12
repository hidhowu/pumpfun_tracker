"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState } from "react";
import {
  Anchor,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Gauge,
  History,
  Search,
  ShieldAlert,
  Target,
  UserCheck,
  Waves,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TraderAvatar } from "@/components/traders/trader-avatar";
import { getPositions, type PositionFilters } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress, formatExactTime, formatHeld, formatPrice, formatRelativeTime, formatTokenAmount, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SimPosition } from "@/lib/types";

type Props = { address: string };

const PAGE_SIZE = 20;

type ReasonMeta = { label: string; icon: typeof UserCheck; className: string };
export const CLOSE_REASON_META: Record<NonNullable<SimPosition["closeReason"]>, ReasonMeta> = {
  trader_sell: { label: "Trader sold", icon: UserCheck, className: "border-line-2 bg-surface-3 text-text-2" },
  stop_loss: { label: "Stop-loss", icon: ShieldAlert, className: "border-destructive/30 bg-neg-soft text-destructive" },
  take_profit: { label: "Take-profit", icon: Target, className: "border-positive/30 bg-pos-soft text-positive" },
  bench: { label: "Bench", icon: Anchor, className: "border-volt-line bg-volt-soft text-primary" },
  trailing_stop: { label: "Trailing stop", icon: Waves, className: "border-volt-line bg-volt-soft text-primary" },
  max_hold_time: { label: "Max hold time", icon: Clock, className: "border-warn/30 bg-warn-soft text-warn" },
  blacklisted: { label: "Trader blacklisted", icon: ShieldAlert, className: "border-line-2 bg-surface-3 text-text-2" },
  no_price: { label: "No price available", icon: ShieldAlert, className: "border-line-2 bg-surface-3 text-text-2" },
};

export function CloseReasonBadge({ reason }: { reason: SimPosition["closeReason"] }) {
  if (!reason) return <span className="text-text-3">—</span>;
  const meta = CLOSE_REASON_META[reason];
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap", meta.className)}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

export const toneClass = (n: number | null | undefined) => (n == null ? "text-text-3" : n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-text-2");
export const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

function TxLink({ label, signature }: { label: string; signature: string | null }) {
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-3 text-[13.5px]">
      <span className="text-text-2">{label}</span>
      {signature ? (
        <span className="inline-flex items-center gap-1.5">
          <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary">
            {formatAddress(signature, 6)}
            <ExternalLink className="size-3 text-text-3" />
          </a>
          <CopyButton value={signature} label="transaction signature" />
        </span>
      ) : (
        <span className="text-text-3">—</span>
      )}
    </div>
  );
}

function DetailRow({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-[34px] items-center justify-between gap-4 text-[13.5px]">
      <span className="text-text-2">{label}</span>
      <span className={cn("text-right font-medium tabular-nums", className)}>{value}</span>
    </div>
  );
}

const Sep = () => <div className="my-0.5 h-px bg-border" />;

/** Value with a small second line underneath ("+$56.00" over "+223.0%"). */
function Stacked({ top, bottom }: { top: React.ReactNode; bottom?: React.ReactNode }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{top}</span>
      {bottom ? <small className="text-[11px] font-normal opacity-80">{bottom}</small> : null}
    </span>
  );
}

/** "$0.35" plus, when the position recorded it, the pump%/Jito split underneath. */
function FeeBreakdown({ total, pump, jito }: { total: number; pump?: number | null; jito?: number | null }) {
  return <Stacked top={formatUsd(total)} bottom={pump != null && jito != null ? `pump ${formatUsd(pump)} + jito ${formatUsd(jito)}` : undefined} />;
}

/** Full detail of one closed simulated trade (a trader's, or a wallet's): prices, fees, P&L, peak / lowest and the exact times it was bought and sold. */
export function TradeDetailDialog({ position, onClose }: { position: SimPosition | null; onClose: () => void }) {
  if (!position) return null;
  const spent = position.costBasisUsd + position.buyFeeUsd;
  const proceedsNet = position.proceedsUsd !== null && position.sellFeeUsd !== null ? position.proceedsUsd - position.sellFeeUsd : null;
  const peakPercent = position.maxUnrealizedPnlPercent;
  // How much of the peak gain was given back by the time it actually closed - e.g. peaked at +100%, closed at +40% => "gave back 60 pts from peak".
  const givenBackPts = peakPercent != null && position.realizedPnlPercent !== null ? peakPercent - position.realizedPnlPercent : null;
  const lowestPercent = position.minUnrealizedPnlPercent;
  // How much it recovered from its lowest point by the time it actually closed - e.g. dipped to -50%, closed at +10% => "recovered 60 pts from the low".
  const recoveredPts = lowestPercent != null && position.realizedPnlPercent !== null ? position.realizedPnlPercent - lowestPercent : null;

  return (
    <Dialog open={!!position} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <a href={`https://pump.fun/coin/${position.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-base hover:text-primary">
              {formatAddress(position.mint, 6)}
              <ExternalLink className="size-3.5 text-text-3" />
            </a>
            <CopyButton value={position.mint} label="token address" />
          </DialogTitle>
          <DialogDescription>Full detail for this simulated trade.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-0.5">
          <div className="flex min-h-[34px] items-center justify-between gap-4 text-[13.5px]">
            <span className="text-text-2">Closed by</span>
            <CloseReasonBadge reason={position.closeReason} />
          </div>
          <Sep />
          <DetailRow label="Token amount" value={formatTokenAmount(position.tokenAmount)} />
          <DetailRow label="Buy price" value={formatPrice(position.buyPriceUsd)} />
          <DetailRow label="Sell price" value={position.sellPriceUsd !== null ? formatPrice(position.sellPriceUsd) : "—"} />
          <Sep />
          <DetailRow label="Amount spent (cost + fee)" value={formatUsd(spent)} />
          <DetailRow label="Buy fee" value={<FeeBreakdown total={position.buyFeeUsd} pump={position.buyPumpFeeUsd} jito={position.buyJitoFeeUsd} />} />
          <DetailRow label="Proceeds (net of fee)" value={proceedsNet !== null ? formatUsd(proceedsNet) : "—"} />
          <DetailRow label="Sell fee" value={position.sellFeeUsd !== null ? <FeeBreakdown total={position.sellFeeUsd} pump={position.sellPumpFeeUsd} jito={position.sellJitoFeeUsd} /> : "—"} />
          <DetailRow
            label="Realized P&L"
            value={<Stacked top={formatUsd(position.realizedPnlUsd)} bottom={position.realizedPnlPercent !== null ? `${position.realizedPnlPercent.toFixed(1)}%` : "-"} />}
            className={toneClass(position.realizedPnlUsd)}
          />
          <Sep />
          <DetailRow
            label={
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="size-3.5 text-text-3" /> Peak (before close)
              </span>
            }
            value={peakPercent != null ? <Stacked top={formatUsd(position.maxUnrealizedPnlUsd)} bottom={`${peakPercent.toFixed(1)}%`} /> : <span className="text-text-3">—</span>}
            className={toneClass(peakPercent)}
          />
          {givenBackPts !== null && givenBackPts > 0.5 && <p className="-mt-1.5 text-right text-[11px] text-text-3">Gave back {givenBackPts.toFixed(1)} pts from peak before closing</p>}
          <DetailRow
            label={
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="size-3.5 text-text-3" /> Lowest (before close)
              </span>
            }
            value={lowestPercent != null ? <Stacked top={formatUsd(position.minUnrealizedPnlUsd)} bottom={`${lowestPercent.toFixed(1)}%`} /> : <span className="text-text-3">—</span>}
            className={toneClass(lowestPercent)}
          />
          {recoveredPts !== null && recoveredPts > 0.5 && <p className="-mt-1.5 text-right text-[11px] text-text-3">Recovered {recoveredPts.toFixed(1)} pts from its low before closing</p>}
          <Sep />
          <DetailRow label="Bought at" value={<Stacked top={`${formatExactTime(position.openedAt)} UTC`} bottom={formatRelativeTime(position.openedAt)} />} />
          <DetailRow
            label="Sold at"
            value={<Stacked top={position.closedAt ? `${formatExactTime(position.closedAt)} UTC` : "—"} bottom={position.closedAt ? formatRelativeTime(position.closedAt) : undefined} />}
          />
          <DetailRow label="Held for" value={position.closedAt ? formatHeld(new Date(position.closedAt).getTime() - new Date(position.openedAt).getTime()) : "—"} />
          <Sep />
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-xs font-medium text-text-3">On-chain trigger transactions</span>
            <TxLink label="Buy trigger" signature={position.openTriggerSignature} />
            <TxLink label="Sell trigger" signature={position.closeTriggerSignature} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MintPill({ mint }: { mint: string }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2">
      <span className="inline-flex items-center gap-1">
        {formatAddress(mint, 5)}
        <ArrowUpRight className="size-3" />
      </span>
      <CopyButton value={mint} label="token address" />
    </span>
  );
}

type Result = "all" | "win" | "loss";
const REASON_OPTIONS = Object.entries(CLOSE_REASON_META) as [string, ReasonMeta][];

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

type Loaded = { key: string; positions: SimPosition[]; totalPages: number; total: number };

export function TradeHistoryList({ address }: Props) {
  const { currentProfileId } = useProfile();
  const [data, setData] = useState<Loaded | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SimPosition | null>(null);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // the search text after a short pause, so typing doesn't fire a request per key
  const [result, setResult] = useState<Result>("all");
  const [reason, setReason] = useState("any");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<"closed" | "pnl">("closed");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const filters: PositionFilters = { q: query, result: result === "all" ? undefined : result, reason: reason === "any" ? undefined : reason, from, to, sort, dir };
  const key = JSON.stringify([currentProfileId, address, page, filters]);
  const loading = data?.key !== key;

  useEffect(() => {
    if (!currentProfileId) return;
    let cancelled = false;
    getPositions(currentProfileId, address, "closed", page, PAGE_SIZE, filters)
      .then((res) => {
        if (!cancelled) setData({ key, positions: res.positions, totalPages: Math.max(1, res.totalPages), total: res.total });
      })
      .catch(() => {
        if (!cancelled) setData({ key, positions: [], totalPages: 1, total: 0 });
      });
    return () => {
      cancelled = true;
    };
    // `filters` is rebuilt every render; `key` already captures everything in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const positions = data?.positions ?? [];
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;
  const anyFilter = !!(query || result !== "all" || reason !== "any" || from || to);

  function change<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }
  const changeSearch = change(setSearch);
  const changeResult = change(setResult);
  const changeReason = change(setReason);
  const changeFrom = change(setFrom);
  const changeTo = change(setTo);

  function toggleSort(next: "closed" | "pnl") {
    setPage(1);
    if (sort === next) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(next);
      setDir("desc");
    }
  }

  function clearFilters() {
    setSearch("");
    setQuery("");
    setResult("all");
    setReason("any");
    setFrom("");
    setTo("");
    setPage(1);
  }

  const reasonLabel = reason === "any" ? "any" : (CLOSE_REASON_META[reason as keyof typeof CLOSE_REASON_META]?.label ?? reason);
  const rangeLabel = from || to ? `${from ? shortDay(from) : "…"} – ${to ? shortDay(to) : "…"}` : "Any date";

  const resultSeg = (
    <div className="inline-flex gap-0.5 rounded-xl border border-border bg-card p-[3px]" role="group" aria-label="Result">
      {(["all", "win", "loss"] as const).map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={result === r}
          onClick={() => changeResult(r)}
          className={cn("h-[30px] rounded-[9px] px-3.5 text-[13px] font-medium transition-colors", result === r ? "bg-surface-4 text-foreground" : "text-text-2 hover:text-foreground")}
        >
          {r === "all" ? "All" : r === "win" ? "Wins" : "Losses"}
        </button>
      ))}
    </div>
  );

  const reasonMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors", reason === "any" ? "border-line-2 bg-card text-text-2 hover:text-foreground" : "border-volt-line bg-volt-soft text-primary")}>
          Closed by: {reasonLabel}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuRadioGroup value={reason} onValueChange={changeReason}>
          <DropdownMenuRadioItem value="any" className="min-h-9">
            Any reason
          </DropdownMenuRadioItem>
          {REASON_OPTIONS.map(([value, meta]) => (
            <DropdownMenuRadioItem key={value} value={value} className="min-h-9">
              {meta.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rangePicker = (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors", from || to ? "border-volt-line bg-volt-soft text-primary" : "border-line-2 bg-card text-text-2 hover:text-foreground")}>
          <Calendar className="size-3.5" />
          {rangeLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-3">From</span>
          <Input type="date" value={from} max={to || undefined} onChange={(e) => changeFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-3">To (inclusive)</span>
          <Input type="date" value={to} min={from || undefined} onChange={(e) => changeTo(e.target.value)} />
        </div>
        {(from || to) && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => { changeFrom(""); changeTo(""); }}>
            Clear dates
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );

  const pager = (
    <div className="flex items-center gap-2 text-xs text-text-2">
      <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
        <ChevronLeft />
      </Button>
      <span className="tabular-nums">
        {page} / {totalPages}
      </span>
      <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
        <ChevronRight />
      </Button>
    </div>
  );

  const sortIcon = (active: boolean) => (active ? dir === "desc" ? <ArrowDown className="size-3 text-primary" /> : <ArrowUp className="size-3 text-primary" /> : <ArrowUpDown className="size-3 opacity-50" />);

  return (
    <div className="flex flex-col overflow-hidden rounded-[20px] border-border bg-card max-md:gap-3 max-md:border-0 max-md:bg-transparent md:border">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-border md:border-b md:px-4 md:py-3">
        <label className="flex h-12 min-w-0 basis-full items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:basis-auto md:w-[260px] md:rounded-[10px]">
          <Search className="size-4 shrink-0" />
          <input value={search} onChange={(e) => changeSearch(e.target.value)} placeholder="Search token or mint" aria-label="Search token or mint" className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]" />
          {search ? (
            <button type="button" onClick={() => changeSearch("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        {resultSeg}
        {reasonMenu}
        {rangePicker}
        <div className="hidden flex-1 md:block" />
        <div className="hidden md:block">{pager}</div>
      </div>

      <div className="flex items-center justify-between md:hidden">
        <span className="text-sm text-text-2">{total} trades</span>
        {pager}
      </div>

      {loading && positions.length === 0 ? (
        <div className="flex flex-col gap-2 md:p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center md:m-5">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <History className="size-6" />
          </span>
          <b className="text-[15px]">{anyFilter ? "No trades match" : "No closed trades yet"}</b>
          {anyFilter ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : (
            <span className="text-[13px] text-text-2">Closed simulated trades will show up here.</span>
          )}
        </div>
      ) : (
        <>
          {/* Phone: one card per closed trade. */}
          <div className={cn("flex flex-col gap-3 md:hidden", loading && "opacity-60")}>
            {positions.map((position) => (
              <article key={position._id} role="button" tabIndex={0} onClick={() => setSelected(position)} onKeyDown={(e) => e.key === "Enter" && setSelected(position)} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                <div className="flex items-center gap-2.5">
                  <TraderAvatar address={position.mint} size="md" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <MintPill mint={position.mint} />
                    <span className="text-xs text-text-3">
                      {formatRelativeTime(position.closedAt)} · held {position.closedAt ? formatHeld(new Date(position.closedAt).getTime() - new Date(position.openedAt).getTime()) : "—"}
                    </span>
                  </div>
                  <div className={cn("flex flex-col items-end", toneClass(position.realizedPnlUsd))}>
                    <b className="text-[17px] font-semibold tabular-nums">{formatUsd(position.realizedPnlUsd)}</b>
                    <span className="text-xs tabular-nums">{position.realizedPnlPercent !== null ? pct(position.realizedPnlPercent) : "-"}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                  <CloseReasonBadge reason={position.closeReason} />
                  <span className="text-text-3">
                    Peak <b className={cn("tabular-nums", toneClass(position.maxUnrealizedPnlPercent))}>{position.maxUnrealizedPnlPercent != null ? pct(position.maxUnrealizedPnlPercent) : "—"}</b> · Low{" "}
                    <b className={cn("tabular-nums", toneClass(position.minUnrealizedPnlPercent))}>{position.minUnrealizedPnlPercent != null ? pct(position.minUnrealizedPnlPercent) : "—"}</b>
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-3 tabular-nums">
                    {formatUsd(position.costBasisUsd)} → {position.proceedsUsd != null ? formatUsd(position.proceedsUsd) : "—"}
                  </span>
                  <span className="font-medium text-primary">Details ›</span>
                </div>
              </article>
            ))}
          </div>

          {/* Desktop: the table. */}
          <div className={cn("max-md:hidden", loading && "opacity-60")}>
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-5">Token</TableHead>
                  <TableHead className="text-right">Entry → Exit</TableHead>
                  <TableHead className="text-right" aria-sort={sort === "pnl" ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                    <button type="button" onClick={() => toggleSort("pnl")} className={cn("inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.07em] uppercase hover:text-foreground", sort === "pnl" ? "text-foreground" : "text-text-3")}>
                      Realized P&amp;L {sortIcon(sort === "pnl")}
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                  <TableHead className="text-right">Lowest</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead>Closed by</TableHead>
                  <TableHead className="pr-5 text-right" aria-sort={sort === "closed" ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                    <button type="button" onClick={() => toggleSort("closed")} className={cn("inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.07em] uppercase hover:text-foreground", sort === "closed" ? "text-foreground" : "text-text-3")}>
                      Closed {sortIcon(sort === "closed")}
                    </button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => (
                  <TableRow key={position._id} className="h-[60px] cursor-pointer border-border" onClick={() => setSelected(position)}>
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-2.5">
                        <TraderAvatar address={position.mint} size="sm" />
                        <MintPill mint={position.mint} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-text-2 tabular-nums">
                      {formatUsd(position.costBasisUsd)} → {position.proceedsUsd != null ? formatUsd(position.proceedsUsd) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      <b className={cn("font-semibold", toneClass(position.realizedPnlUsd))}>{formatUsd(position.realizedPnlUsd)}</b>{" "}
                      <span className={cn("text-xs", toneClass(position.realizedPnlUsd))}>{position.realizedPnlPercent !== null ? pct(position.realizedPnlPercent) : "-"}</span>
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      <span className={cn("inline-flex items-center justify-end gap-1", toneClass(position.maxUnrealizedPnlPercent))}>
                        <Gauge className="size-3 opacity-80" />
                        {position.maxUnrealizedPnlPercent != null ? pct(position.maxUnrealizedPnlPercent) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      <span className={cn("inline-flex items-center justify-end gap-1", toneClass(position.minUnrealizedPnlPercent))}>
                        <Gauge className="size-3 opacity-80" />
                        {position.minUnrealizedPnlPercent != null ? pct(position.minUnrealizedPnlPercent) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-text-3 tabular-nums">{position.closedAt ? formatHeld(new Date(position.closedAt).getTime() - new Date(position.openedAt).getTime()) : "—"}</TableCell>
                    <TableCell>
                      <CloseReasonBadge reason={position.closeReason} />
                    </TableCell>
                    <TableCell className="pr-5 text-right text-[13px] text-text-3">{formatRelativeTime(position.closedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-text-3">
              <span>
                {total} trade{total === 1 ? "" : "s"} · {PAGE_SIZE} per page
              </span>
            </div>
          </div>
        </>
      )}

      <TradeDetailDialog position={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
