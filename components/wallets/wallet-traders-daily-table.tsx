"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
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

function PnlCell({ pnlUsd, tradeCount, wins, losses }: { pnlUsd: number; tradeCount: number; wins: number; losses: number }) {
  if (tradeCount === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <span className={cn(pnlUsd > 0 && "text-positive", pnlUsd < 0 && "text-negative")}>{formatUsd(pnlUsd)}</span>
      <span className="text-[11px] text-muted-foreground">
        {tradeCount} trade{tradeCount === 1 ? "" : "s"} · {wins}W/{losses}L
      </span>
    </span>
  );
}

/**
 * Every assigned trader's realized P&L and trade count for each of the last 7
 * UTC days on this wallet, with per-day and per-trader totals - the detailed
 * counterpart to the Traders Performance overview table.
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
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (data.traders.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
        {emptyMessage ?? "No traders assigned yet - add some to start mirroring their trades on this wallet."}
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
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Trader</TableHead>
            {data.dates.map((date) => {
              const { weekday, md } = dayHeader(date);
              return (
                <TableHead key={date} className="text-right">
                  <span className="block">{weekday}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground">{md}</span>
                </TableHead>
              );
            })}
            <TableHead className={cn("text-right", !hasOverall && "pr-4")}>7-day total</TableHead>
            {hasOverall && <TableHead className="pr-4 text-right">Overall</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.traders.map((t) => (
            <TableRow key={t.traderAddress}>
              <TableCell className="max-w-3xs sm:max-w-xs">
                <a
                  href={`/traders/${t.traderAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 font-mono text-xs hover:text-primary"
                >
                  <span className="truncate">{t.label || formatAddress(t.traderAddress, 6)}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              </TableCell>
              {t.daily.map((d) => (
                <TableCell key={d.date} className="text-right tabular-nums">
                  <PnlCell {...d} />
                </TableCell>
              ))}
              <TableCell className={cn("text-right font-medium tabular-nums", !hasOverall && "pr-4")}>
                <PnlCell pnlUsd={t.totalPnlUsd} tradeCount={t.totalTrades} wins={t.totalWins} losses={t.totalLosses} />
              </TableCell>
              {hasOverall && (
                <TableCell className="pr-4 text-right font-medium tabular-nums">
                  <PnlCell
                    pnlUsd={t.overall?.pnlUsd ?? 0}
                    tradeCount={t.overall?.trades ?? 0}
                    wins={t.overall?.wins ?? 0}
                    losses={t.overall?.losses ?? 0}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium">All traders</TableCell>
            {dayTotals.map((d, i) => (
              <TableCell key={data.dates[i]} className="text-right tabular-nums">
                <PnlCell {...d} />
              </TableCell>
            ))}
            <TableCell className={cn("text-right font-medium tabular-nums", !hasOverall && "pr-4")}>
              <PnlCell {...grand} />
            </TableCell>
            {hasOverall && (
              <TableCell className="pr-4 text-right font-medium tabular-nums">
                <PnlCell {...overallGrand} />
              </TableCell>
            )}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
