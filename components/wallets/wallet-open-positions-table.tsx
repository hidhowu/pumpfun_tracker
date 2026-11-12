"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState, useCallback } from "react";
import { ArrowUpRight, Gauge, Layers } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getWalletPositions } from "@/lib/api";
import { formatAddress, formatRelativeTime, formatTokenAmount, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WalletPositionView } from "@/lib/types";

type Props = { walletId: string; refreshKey?: number };

const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-text-3" : n > 0 ? "text-positive" : "text-negative");
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

function AddressChip({ address, href, label }: { address: string; href: string; label: string }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        {formatAddress(address, 5)}
        <ArrowUpRight className="size-3" />
      </a>
      <CopyButton value={address} label={label} />
    </span>
  );
}

function NoPriceBadge() {
  return <span className="inline-flex h-[22px] items-center rounded-full border border-warn/30 bg-warn-soft px-2 text-[11.5px] font-medium text-warn">price unavailable</span>;
}

/** Mirrors components/traders/open-positions-table.tsx, with a Trader column since a wallet spans many traders. */
export function WalletOpenPositionsTable({ walletId, refreshKey }: Props) {
  const [positions, setPositions] = useState<WalletPositionView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWalletPositions(walletId, "open", 1, 50);
      setPositions(res.positions);
    } finally {
      setLoading(false);
    }
  }, [walletId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <section className="flex flex-col gap-3 md:gap-0 md:overflow-hidden md:rounded-[20px] md:border md:border-border md:bg-card">
      <div className="flex items-center gap-2 px-1 md:border-b md:border-border md:px-5 md:py-4">
        <Layers className="size-4 text-primary" />
        <b className="text-[15px] font-semibold">Open positions</b>
        <span className="inline-flex h-[22px] items-center rounded-full border border-volt-line bg-volt-soft px-2 text-[11.5px] font-medium text-primary">{positions.length}</span>
      </div>

      {loading && positions.length === 0 ? (
        <div className="flex flex-col gap-2.5 md:p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center md:m-5">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <Layers className="size-6" />
          </span>
          <b className="text-sm font-semibold">No open positions</b>
        </div>
      ) : (
        <>
          {/* Phone: one card per position. */}
          <div className="flex flex-col gap-3 md:hidden">
            {positions.map((position) => {
              const hasLivePrice = position.currentValueUsd !== null && position.currentValueUsd !== undefined;
              const unrealized = position.unrealizedPnlUsd ?? null;
              return (
                <article key={position._id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <AddressChip address={position.mint} href={`https://pump.fun/coin/${position.mint}`} label="token address" />
                    {hasLivePrice ? (
                      <b className={cn("font-semibold tabular-nums", tone(unrealized))}>{unrealized !== null ? signedUsd(unrealized) : "—"}</b>
                    ) : (
                      <NoPriceBadge />
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-3">
                    <span className="font-mono">{formatAddress(position.traderAddress, 5)}</span>
                    <span className="tabular-nums">
                      {formatUsd(position.costBasisUsd)} → {hasLivePrice ? formatUsd(position.currentValueUsd) : "—"}
                      {hasLivePrice && position.unrealizedPnlPercent != null ? <span className={cn("ml-1.5", tone(unrealized))}>{pct(position.unrealizedPnlPercent)}</span> : null}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Desktop: the table. */}
          <div className="max-md:hidden">
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={cn(headCls, "pl-5")}>Trader</TableHead>
                  <TableHead className={headCls}>Mint</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Tokens</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Cost basis</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Current value</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Unrealized P&amp;L</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Peak</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Lowest</TableHead>
                  <TableHead className={cn(headCls, "pr-5 text-right")}>Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => {
                  const hasLivePrice = position.currentValueUsd !== null && position.currentValueUsd !== undefined;
                  const unrealized = position.unrealizedPnlUsd ?? null;
                  return (
                    <TableRow key={position._id} className="h-[60px] border-border">
                      <TableCell className="pl-5">
                        <AddressChip address={position.traderAddress} href={`/traders/${position.traderAddress}`} label="address" />
                      </TableCell>
                      <TableCell>
                        <AddressChip address={position.mint} href={`https://pump.fun/coin/${position.mint}`} label="token address" />
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{formatTokenAmount(position.tokenAmount)}</TableCell>
                      <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{formatUsd(position.costBasisUsd)}</TableCell>
                      <TableCell className="text-right text-[13px] font-semibold tabular-nums">{hasLivePrice ? formatUsd(position.currentValueUsd) : "—"}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        {hasLivePrice ? (
                          <span className={cn("inline-flex flex-col items-end leading-[1.3]", tone(unrealized))}>
                            <b className="font-semibold">{unrealized !== null ? signedUsd(unrealized) : "—"}</b>
                            {position.unrealizedPnlPercent != null ? <span className="text-xs">{pct(position.unrealizedPnlPercent)}</span> : null}
                          </span>
                        ) : (
                          <NoPriceBadge />
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <span className={cn("inline-flex items-center justify-end gap-1", tone(position.maxUnrealizedPnlPercent))}>
                          <Gauge className="size-3 opacity-80" />
                          {position.maxUnrealizedPnlPercent == null ? "—" : pct(position.maxUnrealizedPnlPercent)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <span className={cn("inline-flex items-center justify-end gap-1", tone(position.minUnrealizedPnlPercent))}>
                          <Gauge className="size-3 opacity-80" />
                          {position.minUnrealizedPnlPercent == null ? "—" : pct(position.minUnrealizedPnlPercent)}
                        </span>
                      </TableCell>
                      <TableCell className="pr-5 text-right text-[13px] text-text-3">{formatRelativeTime(position.openedAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
