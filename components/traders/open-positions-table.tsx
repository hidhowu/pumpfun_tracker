"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState, useCallback } from "react";
import { ArrowUpRight, Gauge, Layers } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getPositions } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress, formatRelativeTime, formatTokenAmount, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SimPosition } from "@/lib/types";

type Props = { address: string; refreshKey?: number };

const REFRESH_MS = 10_000;

const toneClass = (n: number | null | undefined) => (n == null ? "text-text-3" : n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-text-2");
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

/** The small "address pill" used for a token: link to pump.fun with an arrow, plus a copy button. */
function MintPill({ mint }: { mint: string }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
      <a href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        {formatAddress(mint, 5)}
        <ArrowUpRight className="size-3" />
      </a>
      <CopyButton value={mint} label="token address" />
    </span>
  );
}

function Pnl({ position }: { position: SimPosition }) {
  const hasLivePrice = position.currentValueUsd !== null && position.currentValueUsd !== undefined;
  if (!hasLivePrice) return <span className="inline-flex h-[22px] items-center rounded-full border border-warn/30 bg-warn-soft px-2 text-[11.5px] font-medium text-warn">price unavailable</span>;
  const unrealized = position.unrealizedPnlUsd ?? null;
  return (
    <span className={cn("flex flex-col items-end leading-tight", toneClass(unrealized))}>
      <b className="font-semibold">{formatUsd(unrealized)}</b>
      <span className="text-xs">{position.unrealizedPnlPercent != null ? pct(position.unrealizedPnlPercent) : ""}</span>
    </span>
  );
}

function Gauged({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-text-3">—</span>;
  return (
    <span className={cn("inline-flex items-center justify-end gap-1", toneClass(value))}>
      <Gauge className="size-3 opacity-80" />
      {pct(value)}
    </span>
  );
}

export function OpenPositionsTable({ address, refreshKey }: Props) {
  const { currentProfileId } = useProfile();
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const res = await getPositions(currentProfileId, address, "open", 1, 50);
      setPositions(res.positions);
    } finally {
      setLoading(false);
    }
  }, [currentProfileId, address]);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  return (
    <section className="overflow-hidden rounded-[20px] border-border bg-card max-md:border-0 max-md:bg-transparent md:border">
      <div className="flex items-center justify-between gap-3 md:border-b md:border-border md:px-5 md:py-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold md:text-[15px]">
          <Layers className="size-4 text-primary max-md:hidden" /> Open positions
        </h2>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="size-[7px] rounded-full bg-positive" />
          <span className="text-text-2">
            <span className="md:hidden">Live</span>
            <span className="max-md:hidden">Updates every {REFRESH_MS / 1000} s</span>
          </span>
        </span>
      </div>

      {loading && positions.length === 0 ? (
        <div className="flex flex-col gap-2 py-3 md:p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : positions.length === 0 ? (
        <div className="m-0 flex flex-col items-center justify-center gap-3.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center max-md:mt-3 md:m-5">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <Layers className="size-6" />
          </span>
          <b className="text-[15px]">No open positions</b>
          <span className="text-[13px] text-text-2">Nothing is open right now for this trader.</span>
        </div>
      ) : (
        <>
          {/* Phone: one card per position. */}
          <div className="flex flex-col gap-3 py-3 md:hidden">
            {positions.map((position) => (
              <article key={position._id} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                <div className="flex items-center gap-2.5">
                  <MintPill mint={position.mint} />
                  <div className="flex-1" />
                  <span className="text-xs text-text-3">{formatRelativeTime(position.openedAt)}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11.5px] text-text-3">Unrealized P&amp;L</span>
                  <div className="flex items-baseline gap-2">
                    {position.currentValueUsd == null ? (
                      <Pnl position={position} />
                    ) : (
                      <>
                        <b className={cn("text-lg font-semibold tabular-nums", toneClass(position.unrealizedPnlUsd))}>{formatUsd(position.unrealizedPnlUsd)}</b>
                        <span className={cn("text-xs", toneClass(position.unrealizedPnlUsd))}>{position.unrealizedPnlPercent != null ? pct(position.unrealizedPnlPercent) : ""}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
                  <Kv label="Cost basis" value={formatUsd(position.costBasisUsd)} />
                  <Kv label="Value" value={position.currentValueUsd != null ? formatUsd(position.currentValueUsd) : "—"} />
                  <Kv label="Tokens" value={formatTokenAmount(position.tokenAmount)} />
                  <Kv label="Peak" value={position.maxUnrealizedPnlPercent == null ? "—" : pct(position.maxUnrealizedPnlPercent)} tone={toneClass(position.maxUnrealizedPnlPercent)} />
                  <Kv label="Lowest" value={position.minUnrealizedPnlPercent == null ? "—" : pct(position.minUnrealizedPnlPercent)} tone={toneClass(position.minUnrealizedPnlPercent)} />
                </div>
              </article>
            ))}
          </div>

          {/* Desktop: the table. */}
          <div className="max-md:hidden">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="pl-5">Mint</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost basis</TableHead>
                  <TableHead className="text-right">Current value</TableHead>
                  <TableHead className="text-right">Unrealized P&amp;L</TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                  <TableHead className="text-right">Lowest</TableHead>
                  <TableHead className="pr-5 text-right">Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions.map((position) => (
                  <TableRow key={position._id} className="h-[60px] border-border">
                    <TableCell className="pl-5">
                      <MintPill mint={position.mint} />
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{formatTokenAmount(position.tokenAmount)}</TableCell>
                    <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{formatUsd(position.costBasisUsd)}</TableCell>
                    <TableCell className="text-right text-[13px] font-semibold tabular-nums">{position.currentValueUsd != null ? formatUsd(position.currentValueUsd) : "—"}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      <div className="flex justify-end">
                        <Pnl position={position} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      <Gauged value={position.maxUnrealizedPnlPercent} />
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      <Gauged value={position.minUnrealizedPnlPercent} />
                    </TableCell>
                    <TableCell className="pr-5 text-right text-[13px] text-text-3">{formatRelativeTime(position.openedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}

function Kv({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11.5px] text-text-3">{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}
