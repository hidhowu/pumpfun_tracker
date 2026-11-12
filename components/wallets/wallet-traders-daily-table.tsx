"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getWalletTradersDaily } from "@/lib/api";
import { formatAddress, formatUsd } from "@/lib/format";
import type { WalletTraderDailyPerformance } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  walletId?: string;
  /** Overrides the wallet fetch - lets a trader list reuse this table. When set, rows may carry `overall` and get an extra all-time column. */
  load?: () => Promise<{ dates: string[]; traders: WalletTraderDailyPerformance[] }>;
  emptyMessage?: string;
  refreshKey?: number;
};

function dayHeader(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return { weekday, md: date.slice(5) };
}

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-text-3");
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;
const tradesLabel = (n: number) => `${n} trade${n === 1 ? "" : "s"}`;

function PnlCell({ pnlUsd, tradeCount, wins, losses }: { pnlUsd: number; tradeCount: number; wins: number; losses: number }) {
  if (tradeCount === 0) return <span className="text-text-3">—</span>;
  return (
    <span className="inline-flex flex-col items-end leading-[1.3]">
      <span className={tone(pnlUsd)}>{signedUsd(pnlUsd)}</span>
      <span className="text-[11px] font-normal text-text-3">
        {tradesLabel(tradeCount)} · {wins}W/{losses}L
      </span>
    </span>
  );
}

const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

/**
 * Every assigned trader's realized P&L and trade count for each of the last 7
 * UTC days on this wallet, with per-day and per-trader totals - the detailed
 * counterpart to the Traders Performance overview table. A table on wide
 * screens, one card per trader (with seven little day bars) on phones.
 */
export function WalletTradersDailyTable({ walletId, load, emptyMessage, refreshKey = 0 }: Props) {
  const [data, setData] = useState<{ dates: string[]; traders: WalletTraderDailyPerformance[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (load ? load() : getWalletTradersDaily(walletId as string))
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load daily trader performance"));
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is an inline closure; walletId/refreshKey are the real triggers
  }, [walletId, refreshKey]);

  if (!data) {
    return (
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (data.traders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center md:rounded-none md:border-0 md:bg-transparent">
        <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
          <Users className="size-6" />
        </span>
        <b className="text-sm font-semibold">{emptyMessage ?? "No traders assigned yet - add some to start mirroring their trades on this wallet."}</b>
      </div>
    );
  }

  const dayTotals = data.dates.map((_, i) =>
    data.traders.reduce(
      (acc, t) => ({
        pnlUsd: acc.pnlUsd + t.daily[i].pnlUsd,
        tradeCount: acc.tradeCount + t.daily[i].tradeCount,
        wins: acc.wins + t.daily[i].wins,
        losses: acc.losses + t.daily[i].losses,
      }),
      { pnlUsd: 0, tradeCount: 0, wins: 0, losses: 0 }
    )
  );
  const grand = data.traders.reduce(
    (acc, t) => ({
      pnlUsd: acc.pnlUsd + t.totalPnlUsd,
      tradeCount: acc.tradeCount + t.totalTrades,
      wins: acc.wins + t.totalWins,
      losses: acc.losses + t.totalLosses,
    }),
    { pnlUsd: 0, tradeCount: 0, wins: 0, losses: 0 }
  );

  const hasOverall = data.traders.some((t) => t.overall);
  const overallGrand = data.traders.reduce(
    (acc, t) => ({
      pnlUsd: acc.pnlUsd + (t.overall?.pnlUsd ?? 0),
      tradeCount: acc.tradeCount + (t.overall?.trades ?? 0),
      wins: acc.wins + (t.overall?.wins ?? 0),
      losses: acc.losses + (t.overall?.losses ?? 0),
    }),
    { pnlUsd: 0, tradeCount: 0, wins: 0, losses: 0 }
  );

  return (
    <>
      {/* Phone: one card per trader, the week as seven small bars. */}
      <div className="flex flex-col gap-3 md:hidden">
        {data.traders.map((t) => {
          const peak = Math.max(1, ...t.daily.map((d) => Math.abs(d.pnlUsd)));
          return (
            <article key={t.traderAddress} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <a href={`/traders/${t.traderAddress}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[15px] font-semibold">
                    <span className="truncate">{t.label || formatAddress(t.traderAddress, 6)}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-text-3" />
                  </a>
                  <CopyButton value={t.traderAddress} label="address" />
                </span>
                <div className="flex shrink-0 flex-col items-end">
                  <b className={cn("font-semibold tabular-nums", tone(t.totalPnlUsd))}>{t.totalTrades === 0 ? "—" : signedUsd(t.totalPnlUsd)}</b>
                  <span className="text-xs text-text-3">7-day · {tradesLabel(t.totalTrades)}</span>
                </div>
              </div>
              <div className="flex h-[60px] items-end gap-1" role="img" aria-label={`Realized P&L per day: ${t.daily.map((d) => `${d.date} ${signedUsd(d.pnlUsd)}`).join(", ")}`}>
                {t.daily.map((d) => (
                  <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <i
                      className={cn("block w-full rounded", d.tradeCount === 0 || d.pnlUsd === 0 ? "bg-surface-4" : d.pnlUsd > 0 ? "bg-positive" : "bg-negative")}
                      style={{ height: d.tradeCount === 0 || d.pnlUsd === 0 ? 3 : Math.max(5, (Math.abs(d.pnlUsd) / peak) * 40) }}
                    />
                    <span className="font-mono text-[9px] text-text-3">{dayHeader(d.date).weekday.charAt(0)}</span>
                  </div>
                ))}
              </div>
              {hasOverall && (
                <div className="flex items-center justify-between border-t border-border pt-2.5 text-xs">
                  <span className="text-text-3">Overall</span>
                  <b className={cn("font-semibold tabular-nums", tone(t.overall?.pnlUsd ?? 0))}>
                    {signedUsd(t.overall?.pnlUsd ?? 0)} <span className="font-normal text-text-3">· {tradesLabel(t.overall?.trades ?? 0)}</span>
                  </b>
                </div>
              )}
            </article>
          );
        })}
        <div className="flex items-center justify-between rounded-2xl border border-line-2 bg-surface-2 px-4 py-3.5">
          <b className="text-sm font-semibold">All traders · 7-day</b>
          <div className="flex flex-col items-end">
            <b className={cn("font-semibold tabular-nums", tone(grand.pnlUsd))}>{signedUsd(grand.pnlUsd)}</b>
            <span className="text-xs text-text-3">
              {tradesLabel(grand.tradeCount)} · {grand.wins}W/{grand.losses}L
            </span>
          </div>
        </div>
      </div>

      {/* Wide screens: the table scrolls sideways inside its own box if the window is narrow. */}
      <div className="hidden md:block">
        <Table className="min-w-[1040px]">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className={cn(headCls, "pl-5")}>Trader</TableHead>
              {data.dates.map((date) => {
                const { weekday, md } = dayHeader(date);
                return (
                  <TableHead key={date} className="text-right">
                    <span className={cn("block", headCls)}>{weekday}</span>
                    <span className="block text-[11px] font-normal text-text-3">{md}</span>
                  </TableHead>
                );
              })}
              <TableHead className={cn("text-right", headCls, !hasOverall && "pr-5")}>7-day total</TableHead>
              {hasOverall && <TableHead className={cn("pr-5 text-right", headCls)}>Overall</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.traders.map((t) => (
              <TableRow key={t.traderAddress} className="h-[60px] border-border">
                <TableCell className="max-w-3xs pl-5 sm:max-w-xs">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <a href={`/traders/${t.traderAddress}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-[13px] font-semibold hover:text-primary">
                      <span className="truncate">{t.label || formatAddress(t.traderAddress, 6)}</span>
                      <ArrowUpRight className="size-3 shrink-0 text-text-3" />
                    </a>
                    <CopyButton value={t.traderAddress} label="address" />
                  </span>
                </TableCell>
                {t.daily.map((d) => (
                  <TableCell key={d.date} className="text-right text-[13px] tabular-nums">
                    <PnlCell {...d} />
                  </TableCell>
                ))}
                <TableCell className={cn("text-right text-[13px] font-semibold tabular-nums", !hasOverall && "pr-5")}>
                  <PnlCell pnlUsd={t.totalPnlUsd} tradeCount={t.totalTrades} wins={t.totalWins} losses={t.totalLosses} />
                </TableCell>
                {hasOverall && (
                  <TableCell className="pr-5 text-right text-[13px] font-semibold tabular-nums">
                    <PnlCell pnlUsd={t.overall?.pnlUsd ?? 0} tradeCount={t.overall?.trades ?? 0} wins={t.overall?.wins ?? 0} losses={t.overall?.losses ?? 0} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-transparent">
            <TableRow className="h-14 border-line-2 hover:bg-transparent">
              <TableCell className="pl-5 text-[13px] font-semibold">All traders</TableCell>
              {dayTotals.map((d, i) => (
                <TableCell key={data.dates[i]} className="text-right text-[13px] tabular-nums">
                  <PnlCell {...d} />
                </TableCell>
              ))}
              <TableCell className={cn("text-right text-[13px] font-semibold tabular-nums", !hasOverall && "pr-5")}>
                <PnlCell {...grand} />
              </TableCell>
              {hasOverall && (
                <TableCell className="pr-5 text-right text-[13px] font-semibold tabular-nums">
                  <PnlCell {...overallGrand} />
                </TableCell>
              )}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}
