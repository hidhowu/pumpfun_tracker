"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Gauge, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getWalletPositions } from "@/lib/api";
import { formatAddress, formatRelativeTime, formatUsd } from "@/lib/format";
import type { WalletPositionView } from "@/lib/types";

type Props = { walletId: string };

const CLOSE_REASON_LABEL: Record<string, string> = {
  trader_sell: "Trader sold",
  stop_loss: "Stop-loss",
  take_profit: "Take-profit",
  trailing_stop: "Trailing stop",
  max_hold_time: "Max hold time",
};

export function WalletTradeHistory({ walletId }: Props) {
  const [positions, setPositions] = useState<WalletPositionView[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      try {
        const res = await getWalletPositions(walletId, "closed", targetPage, 20);
        setPositions(res.positions);
        setTotalPages(Math.max(1, res.totalPages));
      } finally {
        setLoading(false);
      }
    },
    [walletId]
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" /> Trade history
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button variant="outline" size="icon" className="size-7" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="tabular-nums">{page} / {totalPages}</span>
          <Button variant="outline" size="icon" className="size-7" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && positions.length === 0 ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            No closed trades yet on this wallet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trader</TableHead>
                  <TableHead>Mint</TableHead>
                  <TableHead className="text-right">Realized P&amp;L</TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                  <TableHead className="text-right">Lowest</TableHead>
                  <TableHead>Closed by</TableHead>
                  <TableHead className="text-right">Closed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => {
                  const pnlPositive = (position.realizedPnlUsd || 0) > 0;
                  const pnlNegative = (position.realizedPnlUsd || 0) < 0;
                  const peakPercent = position.maxUnrealizedPnlPercent;
                  const lowestPercent = position.minUnrealizedPnlPercent;
                  return (
                    <TableRow key={position._id}>
                      <TableCell>
                        <a
                          href={`/traders/${position.traderAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"
                        >
                          {formatAddress(position.traderAddress, 5)}
                          <ExternalLink className="size-3" />
                        </a>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{formatAddress(position.mint, 5)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={["inline-flex flex-col items-end", pnlPositive && "text-positive", pnlNegative && "text-negative"]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span>{formatUsd(position.realizedPnlUsd)}</span>
                          <span className="text-[11px] opacity-80">
                            {position.realizedPnlPercent !== null ? `${position.realizedPnlPercent.toFixed(1)}%` : "-"}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={[
                            "inline-flex items-center justify-end gap-1",
                            peakPercent != null && peakPercent > 0 && "text-positive",
                            peakPercent != null && peakPercent < 0 && "text-negative",
                            peakPercent == null && "text-muted-foreground",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <Gauge className="size-3 opacity-70" />
                          {peakPercent != null ? `${peakPercent.toFixed(1)}%` : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={[
                            "inline-flex items-center justify-end gap-1",
                            lowestPercent != null && lowestPercent > 0 && "text-positive",
                            lowestPercent != null && lowestPercent < 0 && "text-negative",
                            lowestPercent == null && "text-muted-foreground",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <Gauge className="size-3 opacity-70" />
                          {lowestPercent != null ? `${lowestPercent.toFixed(1)}%` : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {position.closeReason ? CLOSE_REASON_LABEL[position.closeReason] ?? position.closeReason : "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{formatRelativeTime(position.closedAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
