"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBacktestPositions } from "@/lib/backtest-api";
import { formatAddress, formatUsd } from "@/lib/format";
import type { BacktestPositionView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { CLOSE_REASON_LABEL, SKIP_REASON_LABEL, formatDateTime, formatDuration, formatSignedPercent, pnlTone } from "./shared";

type StatusFilter = "default" | "closed" | "open" | "skipped";

const PAGE_SIZE = 20;

function formatPrice(price: number | null): string {
  if (price == null) return "—";
  if (price === 0) return "$0";
  return `$${price < 0.01 ? price.toExponential(3) : price.toPrecision(4)}`;
}

function PositionRow({ p, showAddress }: { p: BacktestPositionView; showAddress: boolean }) {
  const held = p.openedAt && p.closedAt ? new Date(p.closedAt).getTime() - new Date(p.openedAt).getTime() : null;
  const pnlUsd = p.status === "open" ? p.unrealizedPnlUsd : p.realizedPnlUsd;
  const pnlPct = p.status === "open" ? p.unrealizedPnlPercent : p.realizedPnlPercent;

  return (
    <TableRow className="border-border/60">
      <TableCell className="max-w-40">
        <div className="flex min-w-0 flex-col gap-0.5">
          <a
            href={`https://pump.fun/coin/${p.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 font-mono text-xs hover:text-primary"
          >
            <span className="truncate">{formatAddress(p.mint, 5)}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
          {showAddress && <span className="truncate font-mono text-[11px] text-muted-foreground">{formatAddress(p.address, 4)}</span>}
        </div>
      </TableCell>
      <TableCell className="text-xs">
        <div className="flex flex-col gap-0.5">
          <span>{formatDateTime(p.traderBuyTime ? p.traderBuyTime * 1000 : p.openedAt)}</span>
          <span className="text-muted-foreground">{p.traderBuyUsd != null ? `trader ${formatUsd(p.traderBuyUsd)}` : ""}</span>
        </div>
      </TableCell>
      <TableCell className="hidden text-right font-mono text-xs md:table-cell">
        <div className="flex flex-col gap-0.5">
          <span>{formatPrice(p.buyPriceUsd)}</span>
          {p.buyPriceSource === "prior_trade" && <span className="text-[11px] text-muted-foreground">last known</span>}
        </div>
      </TableCell>
      <TableCell className="text-xs">
        {p.status === "open" ? (
          <Badge variant="outline" className="border-primary/30 text-primary">
            Open at end
          </Badge>
        ) : p.status === "skipped" ? (
          <Badge variant="outline" className="border-border/60 text-muted-foreground">
            {SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason}
          </Badge>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span>{p.closeReason ? CLOSE_REASON_LABEL[p.closeReason] : "—"}</span>
            <span className="text-muted-foreground">{formatDateTime(p.closedAt)}</span>
          </div>
        )}
      </TableCell>
      <TableCell className="hidden text-right font-mono text-xs md:table-cell">{p.status === "closed" ? formatPrice(p.sellPriceUsd) : p.status === "open" ? formatPrice(p.markPriceUsd) : "—"}</TableCell>
      <TableCell className="hidden text-right text-xs text-muted-foreground lg:table-cell">{formatDuration(held)}</TableCell>
      <TableCell className="hidden text-right text-xs lg:table-cell">
        {p.maxUnrealizedPnlPercent != null ? (
          <div className="flex flex-col gap-0.5 tabular-nums">
            <span className="text-positive">{formatSignedPercent(p.maxUnrealizedPnlPercent, 0)}</span>
            <span className="text-negative">{formatSignedPercent(p.minUnrealizedPnlPercent, 0)}</span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="pr-4 text-right tabular-nums">
        {pnlUsd == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className={cn("font-medium", pnlTone(pnlUsd))}>{formatUsd(pnlUsd)}</span>
            <span className={cn("text-xs", pnlTone(pnlPct))}>{formatSignedPercent(pnlPct)}</span>
          </div>
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

  useEffect(() => {
    let cancelled = false;
    getBacktestPositions(runId, { address, status: status === "default" ? undefined : status, page, limit: PAGE_SIZE })
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load trades"));
    return () => {
      cancelled = true;
    };
  }, [runId, address, status, page, refreshKey]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as StatusFilter);
            setPage(1);
          }}
        >
          <SelectTrigger size="sm" className="w-44" aria-label="Filter trades">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Closed + open</SelectItem>
            <SelectItem value="closed">Closed only</SelectItem>
            <SelectItem value="open">Open at end only</SelectItem>
            <SelectItem value="skipped">Skipped signals</SelectItem>
          </SelectContent>
        </Select>
        {data && <span className="text-xs text-muted-foreground">{data.total.toLocaleString()} total</span>}
      </div>

      {data === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : data.positions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">No trades to show yet.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead>Token</TableHead>
                  <TableHead>Trader bought</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Our entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Exit price</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Held</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Peak / low</TableHead>
                  <TableHead className="pr-4 text-right">P&amp;L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <PositionRow key={p._id} p={p} showAddress={!address} />
                ))}
              </TableBody>
            </Table>
          </div>
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="gap-1">
                <ChevronLeft className="size-4" /> Prev
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {data.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="gap-1">
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
