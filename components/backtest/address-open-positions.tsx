"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Gauge, Layers } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBacktestPositions } from "@/lib/backtest-api";
import { formatAddress, formatTokenAmount, formatUsd } from "@/lib/format";
import type { BacktestPositionView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { formatDateTime, formatSignedPercent, pnlTone } from "./shared";

const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

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

function PeakLow({ value }: { value: number | null }) {
  return (
    <span className={cn("inline-flex items-center justify-end gap-1", value == null ? "text-text-3" : pnlTone(value))}>
      <Gauge className="size-3 opacity-80" />
      {value == null ? "—" : formatSignedPercent(value)}
    </span>
  );
}

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
    <section className="flex flex-col gap-3 md:gap-0 md:overflow-hidden md:rounded-[20px] md:border md:border-border md:bg-card">
      <div className="flex items-center gap-2 px-1 md:border-b md:border-border md:px-5 md:py-4">
        <Layers className="size-4 text-primary" />
        <b className="text-[15px] font-semibold">Open positions</b>
        {positions && <span className="inline-flex h-[22px] items-center rounded-full border border-volt-line bg-volt-soft px-2 text-[11.5px] font-medium text-primary">{positions.length}</span>}
        <HelpTip className="ml-0">Still held when the backtest window ended, valued at the last pool price. They are not counted in realized P&amp;L.</HelpTip>
      </div>

      {positions === null ? (
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
          <span className="text-[13px] text-text-3">Every trade had closed by the end of the window.</span>
        </div>
      ) : (
        <>
          {/* Phone: one card per position. */}
          <div className="flex flex-col gap-3 md:hidden">
            {positions.map((p) => {
              const unrealized = p.unrealizedPnlUsd;
              const cost = (p.costBasisUsd ?? 0) + (p.buyFeeUsd ?? 0);
              return (
                <article key={p._id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <AddressChip address={p.mint} href={`https://pump.fun/coin/${p.mint}`} label="token address" />
                    {unrealized != null ? <b className={cn("font-semibold tabular-nums", pnlTone(unrealized))}>{signedUsd(unrealized)}</b> : <NoPriceBadge />}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-text-3">
                    <span>{formatDateTime(p.openedAt)}</span>
                    <span className="tabular-nums">
                      {formatUsd(p.costBasisUsd)} → {unrealized != null ? formatUsd(cost + unrealized) : "—"}
                      {unrealized != null && p.unrealizedPnlPercent != null ? <span className={cn("ml-1.5", pnlTone(unrealized))}>{formatSignedPercent(p.unrealizedPnlPercent)}</span> : null}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Wide screens: the table scrolls sideways inside its box. */}
          <div className="max-md:hidden">
            <Table className="min-w-[1000px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={cn(headCls, "pl-5")}>Mint</TableHead>
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
                {positions.map((p) => {
                  const unrealized = p.unrealizedPnlUsd;
                  const cost = (p.costBasisUsd ?? 0) + (p.buyFeeUsd ?? 0);
                  return (
                    <TableRow key={p._id} className="h-[60px] border-border">
                      <TableCell className="pl-5">
                        <AddressChip address={p.mint} href={`https://pump.fun/coin/${p.mint}`} label="token address" />
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{formatTokenAmount(p.tokenAmount)}</TableCell>
                      <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{formatUsd(p.costBasisUsd)}</TableCell>
                      <TableCell className="text-right text-[13px] font-semibold tabular-nums">{unrealized != null ? formatUsd(cost + unrealized) : "—"}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        {unrealized != null ? (
                          <span className={cn("inline-flex flex-col items-end leading-[1.3]", pnlTone(unrealized))}>
                            <b className="font-semibold">{signedUsd(unrealized)}</b>
                            <span className="text-xs">{formatSignedPercent(p.unrealizedPnlPercent)}</span>
                          </span>
                        ) : (
                          <NoPriceBadge />
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <PeakLow value={p.maxUnrealizedPnlPercent} />
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <PeakLow value={p.minUnrealizedPnlPercent} />
                      </TableCell>
                      <TableCell className="pr-5 text-right text-xs whitespace-nowrap text-text-3">{formatDateTime(p.openedAt)}</TableCell>
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
