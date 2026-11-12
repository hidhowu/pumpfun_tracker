"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Gauge, History, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getWalletPositions } from "@/lib/api";
import { formatAddress, formatExactTime, formatRelativeTime, formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { WalletPositionView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CLOSE_REASON_META, CloseReasonBadge, TradeDetailDialog, pct, toneClass } from "@/components/traders/trade-history-list";

type Props = { walletId: string };
type Result = "all" | "win" | "loss";

const PAGE_SIZE = 20;
const RESULTS = [
  { value: "all", label: "All" },
  { value: "win", label: "Wins" },
  { value: "loss", label: "Losses" },
] as const;
const REASON_OPTIONS = Object.entries(CLOSE_REASON_META);
const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

type Loaded = { key: string; positions: WalletPositionView[]; totalPages: number; total: number };

function AddressChip({ address, href, label }: { address: string; href?: string; label: string }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
      {href ? (
        <a href={href} onClick={(e) => e.stopPropagation()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
          {formatAddress(address, 5)}
          <ArrowUpRight className="size-3" />
        </a>
      ) : (
        <span>{formatAddress(address, 5)}</span>
      )}
      <CopyButton value={address} label={label} />
    </span>
  );
}

export function WalletTradeHistory({ walletId }: Props) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const [data, setData] = useState<Loaded | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<WalletPositionView | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // the search text after a short pause, so typing doesn't fire a request per key
  const [result, setResult] = useState<Result>("all");
  const [reason, setReason] = useState("any");

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const filters = { q: query, result: result === "all" ? undefined : result, reason: reason === "any" ? undefined : reason };
  const key = JSON.stringify([walletId, page, filters]);
  const loading = data?.key !== key;

  useEffect(() => {
    let cancelled = false;
    getWalletPositions(walletId, "closed", page, PAGE_SIZE, filters)
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
  const anyFilter = !!(query || result !== "all" || reason !== "any");

  function clearFilters() {
    setSearch("");
    setQuery("");
    setResult("all");
    setReason("any");
    setPage(1);
  }

  const reasonLabel = reason === "any" ? "any" : (CLOSE_REASON_META[reason as keyof typeof CLOSE_REASON_META]?.label ?? reason);

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

  return (
    <div className="flex flex-col overflow-hidden rounded-[20px] border-border bg-card max-md:gap-3 max-md:border-0 max-md:bg-transparent md:border">
      <div className="flex flex-wrap items-center gap-3 border-border md:border-b md:px-4 md:py-3">
        <label className="flex h-12 min-w-0 basis-full items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:basis-auto md:w-[280px] md:rounded-[10px]">
          <Search className="size-4 shrink-0" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search token, mint or trader"
            aria-label="Search token, mint or trader"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        <Segmented
          options={RESULTS}
          value={result}
          onChange={(v) => {
            setResult(v);
            setPage(1);
          }}
          label="Result"
          block={phone}
          tall={phone}
          className="max-md:basis-full"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] whitespace-nowrap transition-colors max-md:h-10", reason === "any" ? "border-line-2 bg-card text-text-2 hover:text-foreground" : "border-volt-line bg-volt-soft text-primary")}
            >
              Closed by: {reasonLabel}
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuRadioGroup
              value={reason}
              onValueChange={(v) => {
                setReason(v);
                setPage(1);
              }}
            >
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
        <div className="hidden flex-1 md:block" />
        <div className="hidden md:block">{pager}</div>
      </div>

      <div className="flex items-center justify-between md:hidden">
        <span className="text-sm text-text-2">{total} trades</span>
        {pager}
      </div>

      {loading && positions.length === 0 ? (
        <div className="flex flex-col gap-2.5 md:p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center md:m-5">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <History className="size-6" />
          </span>
          <b className="text-[15px] font-semibold">{anyFilter ? "No trades match" : "No closed trades yet on this wallet"}</b>
          {anyFilter ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* Phone: one card per closed trade. */}
          <div className={cn("flex flex-col gap-3 md:hidden", loading && "opacity-60")}>
            {positions.map((position) => (
              <article key={position._id} role="button" tabIndex={0} onClick={() => setSelected(position)} onKeyDown={(e) => e.key === "Enter" && setSelected(position)} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <AddressChip address={position.mint} label="token address" />
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
                <div className="flex items-center justify-between text-xs text-text-3">
                  <span className="font-mono">{formatAddress(position.traderAddress, 5)}</span>
                  <span>{formatRelativeTime(position.closedAt)}</span>
                </div>
              </article>
            ))}
          </div>

          {/* Desktop: the table. */}
          <div className={cn("max-md:hidden", loading && "opacity-60")}>
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={cn(headCls, "pl-5")}>Trader</TableHead>
                  <TableHead className={headCls}>Mint</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Realized P&amp;L</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Peak</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Lowest</TableHead>
                  <TableHead className={headCls}>Closed by</TableHead>
                  <TableHead className={cn(headCls, "pr-5 text-right")}>Sold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => (
                  <TableRow key={position._id} className="h-[60px] cursor-pointer border-border" onClick={() => setSelected(position)}>
                    <TableCell className="pl-5">
                      <AddressChip address={position.traderAddress} href={`/traders/${position.traderAddress}`} label="address" />
                    </TableCell>
                    <TableCell>
                      <AddressChip address={position.mint} label="token address" />
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      <span className={cn("inline-flex flex-col items-end leading-[1.3]", toneClass(position.realizedPnlUsd))}>
                        <b className="font-semibold">{formatUsd(position.realizedPnlUsd)}</b>
                        <span className="text-xs">{position.realizedPnlPercent !== null ? pct(position.realizedPnlPercent) : "-"}</span>
                      </span>
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
                    <TableCell>
                      <CloseReasonBadge reason={position.closeReason} />
                    </TableCell>
                    <TableCell className="pr-5 text-right text-[13px] whitespace-nowrap">
                      <span className="inline-flex flex-col items-end leading-[1.3]">
                        <span className="text-xs text-text-2">{formatExactTime(position.closedAt)}</span>
                        <span className="text-[11px] text-text-3">{formatRelativeTime(position.closedAt)}</span>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <TradeDetailDialog position={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
