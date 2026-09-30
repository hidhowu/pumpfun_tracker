"use client";

import { useEffect, useState, useCallback } from "react";
import { ExternalLink, Gauge, Layers, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPositions } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress, formatRelativeTime, formatTokenAmount, formatUsd } from "@/lib/format";
import type { SimPosition } from "@/lib/types";

type Props = { address: string; refreshKey?: number };

export function OpenPositionsTable({ address, refreshKey }: Props) {
  const { currentProfileId } = useProfile();
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentProfileId) return;
    setLoading(true);
    try {
      const res = await getPositions(currentProfileId, address, "open", 1, 50);
      setPositions(res.positions);
    } finally {
      setLoading(false);
    }
  }, [currentProfileId, address]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-primary" /> Open positions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && positions.length === 0 ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            No open positions
          </div>
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
                {positions.map((position) => {
                  const hasLivePrice = position.currentValueUsd !== null && position.currentValueUsd !== undefined;
                  const unrealized = position.unrealizedPnlUsd ?? null;
                  const isPositive = (unrealized ?? 0) > 0;
                  const isNegative = (unrealized ?? 0) < 0;
                  return (
                    <TableRow key={position._id}>
                      <TableCell>
                        <a
                          href={`https://pump.fun/coin/${position.mint}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"
                        >
                          {formatAddress(position.mint, 5)}
                          <ExternalLink className="size-3" />
                        </a>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatTokenAmount(position.tokenAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{formatUsd(position.costBasisUsd)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {hasLivePrice ? formatUsd(position.currentValueUsd) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hasLivePrice ? (
                          <span
                            className={[
                              "inline-flex items-center justify-end gap-1",
                              isPositive && "text-positive",
                              isNegative && "text-negative",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            {isPositive ? <TrendingUp className="size-3.5" /> : isNegative ? <TrendingDown className="size-3.5" /> : null}
                            <span className="flex flex-col items-end">
                              <span>{formatUsd(unrealized)}</span>
                              <span className="text-[11px] opacity-80">
                                {position.unrealizedPnlPercent != null ? `${position.unrealizedPnlPercent.toFixed(1)}%` : ""}
                              </span>
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">price unavailable</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {position.maxUnrealizedPnlPercent == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={[
                              "inline-flex items-center justify-end gap-1",
                              position.maxUnrealizedPnlPercent > 0 && "text-positive",
                              position.maxUnrealizedPnlPercent < 0 && "text-negative",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <Gauge className="size-3.5 opacity-70" />
                            {position.maxUnrealizedPnlPercent.toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {position.minUnrealizedPnlPercent == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={[
                              "inline-flex items-center justify-end gap-1",
                              position.minUnrealizedPnlPercent > 0 && "text-positive",
                              position.minUnrealizedPnlPercent < 0 && "text-negative",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            <Gauge className="size-3.5 opacity-70" />
                            {position.minUnrealizedPnlPercent.toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatRelativeTime(position.openedAt)}
                      </TableCell>
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
