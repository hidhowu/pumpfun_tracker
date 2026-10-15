"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState } from "react";
import { ExternalLink, Gauge, Layers, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBacktestPositions } from "@/lib/backtest-api";
import { formatAddress, formatTokenAmount, formatUsd } from "@/lib/format";
import type { BacktestPositionView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { formatDateTime, formatSignedPercent, pnlTone } from "./shared";

/** Trades still held when the backtest window ended (marked at the last pool price) - the counterpart of a live trader's "Open positions". */
export function AddressOpenPositions({ runId, address, refreshKey }: { runId: string; address: string; refreshKey: number }) {
  const [positions, setPositions] = useState<BacktestPositionView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBacktestPositions(runId, { address, status: "open", page: 1, limit: 50 })
      .then((res) => !cancelled && setPositions(res.positions))
      .catch(() => !cancelled && setPositions((prev) => prev ?? []));
    return () => {
      cancelled = true;
    };
  }, [runId, address, refreshKey]);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-primary" /> Open positions
        </CardTitle>
        <CardDescription>Still held when the backtest window ended, valued at the last pool price. They are not counted in realized P&amp;L.</CardDescription>
      </CardHeader>
      <CardContent>
        {positions === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">No open positions</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mint</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost basis</TableHead>
                  <TableHead className="text-right">Current value</TableHead>
                  <TableHead className="text-right">Unrealized P&amp;L</TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                  <TableHead className="text-right">Lowest</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((p) => {
                  const unrealized = p.unrealizedPnlUsd;
                  const cost = (p.costBasisUsd ?? 0) + (p.buyFeeUsd ?? 0);
                  const Trend = (unrealized ?? 0) > 0 ? TrendingUp : (unrealized ?? 0) < 0 ? TrendingDown : null;
                  return (
                    <TableRow key={p._id}>
                      <TableCell>
                        <span className="inline-flex min-w-0 items-center gap-1"><a href={`https://pump.fun/coin/${p.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary">
                          {formatAddress(p.mint, 5)}
                          <ExternalLink className="size-3" />
                        </a><CopyButton value={p.mint} label="token address" /></span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatTokenAmount(p.tokenAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatUsd(p.costBasisUsd)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{unrealized != null ? formatUsd(cost + unrealized) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {unrealized != null ? (
                          <span className={cn("inline-flex items-center justify-end gap-1", pnlTone(unrealized))}>
                            {Trend && <Trend className="size-3.5" />}
                            <span className="flex flex-col items-end">
                              <span>{formatUsd(unrealized)}</span>
                              <span className="text-[11px] opacity-80">{formatSignedPercent(p.unrealizedPnlPercent)}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">price unavailable</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.maxUnrealizedPnlPercent == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={cn("inline-flex items-center justify-end gap-1", pnlTone(p.maxUnrealizedPnlPercent))}>
                            <Gauge className="size-3.5 opacity-70" />
                            {p.maxUnrealizedPnlPercent.toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.minUnrealizedPnlPercent == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={cn("inline-flex items-center justify-end gap-1", pnlTone(p.minUnrealizedPnlPercent))}>
                            <Gauge className="size-3.5 opacity-70" />
                            {p.minUnrealizedPnlPercent.toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(p.openedAt)}</TableCell>
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
