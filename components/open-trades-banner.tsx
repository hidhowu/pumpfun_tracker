"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Gauge, Layers, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { getAllOpenPositions } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress, formatRelativeTime, formatTokenAmount, formatUsd } from "@/lib/format";
import type { OpenPositionWithTrader } from "@/lib/types";

const POLL_INTERVAL_MS = 15000;

/**
 * Header banner showing the count of open simulated positions across EVERY
 * tracked trader in the current profile (not scoped to whichever trader
 * page you happen to be on). Clicking it opens a Sheet listing all of them.
 */
export function OpenTradesBanner() {
  const { currentProfileId } = useProfile();
  const [positions, setPositions] = useState<OpenPositionWithTrader[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { positions } = await getAllOpenPositions(currentProfileId);
      setPositions(positions);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentProfileId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5 px-2 sm:px-3" onClick={() => setOpen(true)}>
        <Layers className="size-3.5 text-primary" />
        {loading && positions.length === 0 ? "…" : positions.length}
        {/* Full label only once there's room for it - this button sits in the
            app-wide header alongside the profile switcher, and on a narrow
            phone ("375px") the two together can exceed the viewport width
            with the full label. */}
        <span className="hidden sm:inline">
          {" "}
          open trade{positions.length === 1 ? "" : "s"}
        </span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Layers className="size-4 text-primary" /> Open trades
            </SheetTitle>
            <SheetDescription>
              Every currently-open simulated position across all tracked traders in this profile.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-auto px-4 pb-4">
            {loading && positions.length === 0 ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : positions.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
                No open positions right now
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trader</TableHead>
                      <TableHead>Mint</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Value</TableHead>
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
                            <Link
                              href={`/traders/${position.traderAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary"
                            >
                              {position.traderLabel || formatAddress(position.traderAddress, 5)}
                              <ExternalLink className="size-3" />
                            </Link>
                          </TableCell>
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
                              <span className="text-muted-foreground">unavailable</span>
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
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
