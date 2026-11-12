"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, ChevronLeft, ChevronRight, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBacktestPositions } from "@/lib/backtest-api";
import { formatAddress, formatUsd } from "@/lib/format";
import type { BacktestPositionView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { TradeDetailDialog } from "./address-trade-history";
import { EmptyNote } from "./parts";
import { CLOSE_REASON_LABEL, Pill, SKIP_REASON_LABEL, formatDateTime, formatDuration, formatSignedPercent, pnlTone } from "./shared";

type StatusFilter = "default" | "closed" | "open" | "skipped";

const PAGE_SIZE = 20;
const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

function formatPrice(price: number | null): string {
  if (price == null) return "—";
  if (price === 0) return "$0";
  return `$${price < 0.01 ? price.toExponential(3) : price.toPrecision(4)}`;
}

function AddressChip({ address, href, label, short = 5 }: { address: string; href?: string; label: string; short?: number }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
      {href ? (
        <a href={href} onClick={(e) => e.stopPropagation()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
          {formatAddress(address, short)}
          <ArrowUpRight className="size-3" />
        </a>
      ) : (
        <span>{formatAddress(address, short)}</span>
      )}
      <CopyButton value={address} label={label} />
    </span>
  );
}

function ExitCell({ p }: { p: BacktestPositionView }) {
  if (p.status === "open") return <Pill tone="volt">Open at end</Pill>;
  if (p.status === "skipped") return <Pill>{SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason}</Pill>;
  return (
    <span className="inline-flex flex-col leading-[1.3]">
      <span className="text-[13px]">{p.closeReason ? CLOSE_REASON_LABEL[p.closeReason] : "—"}</span>
      <span className="text-xs text-text-3">{formatDateTime(p.closedAt)}</span>
    </span>
  );
}

function PositionRow({ p, showAddress, onSelect }: { p: BacktestPositionView; showAddress: boolean; onSelect: () => void }) {
  const held = p.openedAt && p.closedAt ? new Date(p.closedAt).getTime() - new Date(p.openedAt).getTime() : null;
  const pnlUsd = p.status === "open" ? p.unrealizedPnlUsd : p.realizedPnlUsd;
  const pnlPct = p.status === "open" ? p.unrealizedPnlPercent : p.realizedPnlPercent;

  return (
    <TableRow className="h-[64px] cursor-pointer border-border" onClick={onSelect}>
      <TableCell className="pl-5">
        <div className="flex flex-col gap-1">
          <AddressChip address={p.mint} href={`https://pump.fun/coin/${p.mint}`} label="token address" />
          {showAddress && <AddressChip address={p.address} label="address" short={4} />}
        </div>
      </TableCell>
      <TableCell>
        <span className="inline-flex flex-col text-xs leading-[1.3]">
          <span>{formatDateTime(p.traderBuyTime ? p.traderBuyTime * 1000 : p.openedAt)}</span>
          <span className="text-text-3">{p.traderBuyUsd != null ? `trader ${formatUsd(p.traderBuyUsd)}` : ""}</span>
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-xs">
        <span className="inline-flex flex-col items-end leading-[1.3]">
          <span>{formatPrice(p.buyPriceUsd)}</span>
          {p.buyPriceSource === "prior_trade" && <span className="font-sans text-[11px] text-text-3">last known</span>}
        </span>
      </TableCell>
      <TableCell>
        <ExitCell p={p} />
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{p.status === "closed" ? formatPrice(p.sellPriceUsd) : p.status === "open" ? formatPrice(p.markPriceUsd) : "—"}</TableCell>
      <TableCell className="text-right text-xs text-text-3">{formatDuration(held)}</TableCell>
      <TableCell className="text-right text-xs">
        {p.maxUnrealizedPnlPercent != null ? (
          <span className="inline-flex flex-col leading-[1.3] tabular-nums">
            <span className="text-positive">{formatSignedPercent(p.maxUnrealizedPnlPercent, 0)}</span>
            <span className="text-negative">{formatSignedPercent(p.minUnrealizedPnlPercent, 0)}</span>
          </span>
        ) : (
          <span className="text-text-3">—</span>
        )}
      </TableCell>
      <TableCell className="pr-5 text-right tabular-nums">
        {pnlUsd == null ? (
          <span className="text-text-3">—</span>
        ) : (
          <span className="inline-flex flex-col items-end leading-[1.3]">
            <b className={cn("text-[13px] font-semibold", pnlTone(pnlUsd))}>{formatUsd(pnlUsd)}</b>
            <span className={cn("text-xs", pnlTone(pnlPct))}>{formatSignedPercent(pnlPct)}</span>
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** A run's simulated trades (or one address's), newest first, paginated. Refetches when `refreshKey` changes so a running backtest's list keeps growing. */
export function PositionsTable({ runId, address, refreshKey = 0 }: { runId: string; address?: string; refreshKey?: number }) {
  const [status, setStatus] = useState<StatusFilter>("default");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ positions: BacktestPositionView[]; total: number; totalPages: number } | null>(null);
  const [selected, setSelected] = useState<BacktestPositionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBacktestPositions(runId, { address, status: status === "default" ? undefined : status, page, limit: PAGE_SIZE })
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load trades"));
    return () => {
      cancelled = true;
    };
  }, [runId, address, status, page, refreshKey]);

  const pager =
    data && data.totalPages > 1 ? (
      <div className="flex items-center gap-2 text-xs text-text-2">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft />
        </Button>
        <span className="tabular-nums">
          {page} / {data.totalPages}
        </span>
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
          <ChevronRight />
        </Button>
      </div>
    ) : null;

  return (
    <div className="flex flex-col overflow-hidden rounded-[20px] border-border bg-card max-md:gap-3 max-md:border-0 max-md:bg-transparent md:border">
      <div className="flex flex-wrap items-center gap-3 border-border md:border-b md:px-4 md:py-3">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-44 max-md:h-11 max-md:flex-1" aria-label="Filter trades">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Closed + open</SelectItem>
            <SelectItem value="closed">Closed only</SelectItem>
            <SelectItem value="open">Open at end only</SelectItem>
            <SelectItem value="skipped">Skipped signals</SelectItem>
          </SelectContent>
        </Select>
        {data && <span className="text-xs text-text-3">{data.total.toLocaleString()} total</span>}
        <div className="flex-1" />
        {pager}
      </div>

      {data === null ? (
        <div className="flex flex-col gap-2.5 md:p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : data.positions.length === 0 ? (
        <EmptyNote icon={<Coins className="size-5" />}>No trades to show yet.</EmptyNote>
      ) : (
        <>
          {/* Phone: one card per trade. */}
          <div className="flex flex-col gap-3 md:hidden">
            {data.positions.map((p) => {
              const pnlUsd = p.status === "open" ? p.unrealizedPnlUsd : p.realizedPnlUsd;
              const pnlPct = p.status === "open" ? p.unrealizedPnlPercent : p.realizedPnlPercent;
              return (
                <article key={p._id} role="button" tabIndex={0} onClick={() => setSelected(p)} onKeyDown={(e) => e.key === "Enter" && setSelected(p)} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <AddressChip address={p.mint} label="token address" />
                    {pnlUsd == null ? (
                      <span className="text-text-3">—</span>
                    ) : (
                      <span className="flex flex-col items-end leading-[1.3]">
                        <b className={cn("font-semibold tabular-nums", pnlTone(pnlUsd))}>{formatUsd(pnlUsd)}</b>
                        <span className={cn("text-xs tabular-nums", pnlTone(pnlPct))}>{formatSignedPercent(pnlPct)}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-text-3">
                    <span>{p.status === "open" ? "Open at end" : p.status === "skipped" ? (SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason) : (p.closeReason ? CLOSE_REASON_LABEL[p.closeReason] : "—")}</span>
                    <span>{p.status === "closed" ? formatDateTime(p.closedAt) : formatDateTime(p.openedAt)}</span>
                  </div>
                  {!address && <span className="font-mono text-[11px] text-text-3">{formatAddress(p.address, 5)}</span>}
                </article>
              );
            })}
          </div>

          {/* Wide screens: the table scrolls sideways inside its box. */}
          <div className="max-md:hidden">
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={cn(headCls, "pl-5")}>Token</TableHead>
                  <TableHead className={headCls}>Trader bought</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Our entry</TableHead>
                  <TableHead className={headCls}>Exit</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Exit price</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Held</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Peak / low</TableHead>
                  <TableHead className={cn(headCls, "pr-5 text-right")}>P&amp;L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <PositionRow key={p._id} p={p} showAddress={!address} onSelect={() => setSelected(p)} />
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
