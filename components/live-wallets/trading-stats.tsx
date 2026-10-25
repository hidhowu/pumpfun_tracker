"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getTradingStats } from "@/lib/live-wallet-api";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Latency, TxCounts, TxStats } from "@/lib/live-wallet-types";

const POLL_MS = 15_000;
const RANGES = [
  { label: "All time", hours: undefined },
  { label: "24 hours", hours: 24 },
  { label: "1 hour", hours: 1 },
] as const;

/** Milliseconds as "840 ms" or "2.31 s". */
function ms(value: number | null | undefined) {
  if (value == null) return "-";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" | "good" }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-lg font-extrabold tabular-nums", tone === "bad" && "text-negative", tone === "good" && "text-positive")}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function SpeedRow({ label, latency, strong }: { label: string; latency: Latency; strong?: boolean }) {
  return (
    <tr className={cn("border-t border-border/60", strong && "font-bold")}>
      <td className="py-1.5 pr-3 text-left">{label}</td>
      <td className="px-2 text-right tabular-nums">{latency.count}</td>
      <td className="px-2 text-right tabular-nums">{ms(latency.minMs)}</td>
      <td className="px-2 text-right tabular-nums">{ms(latency.p10Ms)}</td>
      <td className="px-2 text-right tabular-nums">{ms(latency.p50Ms)}</td>
      <td className="px-2 text-right tabular-nums">{ms(latency.avgMs)}</td>
      <td className="px-2 text-right tabular-nums">{ms(latency.p90Ms)}</td>
      <td className="px-2 text-right tabular-nums">{ms(latency.p99Ms)}</td>
      <td className="pl-2 text-right tabular-nums">{ms(latency.maxMs)}</td>
    </tr>
  );
}

function CountsRow({ label, c }: { label: string; c: TxCounts }) {
  return (
    <tr className="border-t border-border/60">
      <td className="py-1.5 pr-3 text-left">{label}</td>
      <td className="px-2 text-right tabular-nums">{c.attempts}</td>
      <td className="px-2 text-right tabular-nums text-positive">{c.success}</td>
      <td className={cn("px-2 text-right tabular-nums", c.reverted && "text-negative")}>{c.reverted}</td>
      <td className={cn("px-2 text-right tabular-nums", c.expired && "text-negative")}>{c.expired}</td>
      <td className={cn("px-2 text-right tabular-nums", c.error && "text-negative")}>{c.error}</td>
      <td className="px-2 text-right tabular-nums">{c.retries}</td>
      <td className="pl-2 text-right tabular-nums">{c.successRate == null ? "-" : `${c.successRate.toFixed(0)}%`}</td>
    </tr>
  );
}

const OUTCOME_LABEL = { reverted: "refused by the program", expired: "never landed", error: "failed before landing" } as const;

/** How the wallet's transactions are doing: speed (build to landed), successes, failures and retries. */
export function TradingStats({ walletId, refreshKey }: { walletId: string; refreshKey: number }) {
  const [hours, setHours] = useState<number | undefined>(undefined);
  const [stats, setStats] = useState<TxStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStats(await getTradingStats(walletId, hours));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the stats");
    }
  }, [walletId, hours]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  if (error && !stats) return <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  if (!stats) return <Skeleton className="h-64 w-full rounded-2xl" />;

  const t = stats.total;
  const failedAttempts = t.reverted + t.expired + t.error;
  const raw = stats.byMode.raw;
  const jito = stats.byMode.jito;
  const showModes = raw.attempts > 0 && jito.attempts > 0;

  return (
    <Card className="gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-brand-soft">
            <Gauge className="size-5" />
          </span>
          <div>
            <div className="text-[15px] font-extrabold">Transaction stats</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Speed is the time from the moment a trade starts being built to the moment it is first seen on the chain. Only real transactions count - a dry run sends nothing.
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <Button key={r.label} size="sm" variant={hours === r.hours ? "default" : "outline"} onClick={() => setHours(r.hours)}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {t.attempts === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">No real transactions in this period yet. Stats appear once the wallet trades live.</div>
      ) : (
        <>
          {stats.slowing ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-amber-500">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              The last {stats.recentLatency.count} transactions took {ms(stats.recentLatency.p50Ms)} at the median, against {ms(stats.latency.p50Ms)} overall. Transactions are slowing down
              {raw.attempts > 0 && jito.attempts === 0 ? " - consider switching to Jito." : "."}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile label="Median speed" value={ms(stats.latency.p50Ms)} hint={`${stats.latency.count} timed transactions`} />
            <Tile label="Fastest / slowest" value={`${ms(stats.latency.minMs)} / ${ms(stats.latency.maxMs)}`} />
            <Tile label="Success rate" value={t.successRate == null ? "-" : `${t.successRate.toFixed(1)}%`} hint={`${t.success} of ${t.attempts} attempts`} tone={t.successRate != null && t.successRate < 90 ? "bad" : "good"} />
            <Tile label="Retries" value={String(t.retries)} hint={`${t.tradesFailed} trade${t.tradesFailed === 1 ? "" : "s"} without a success`} tone={t.tradesFailed ? "bad" : undefined} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-1 pr-3 text-left font-semibold">Speed</th>
                  <th className="px-2 text-right font-semibold">Count</th>
                  <th className="px-2 text-right font-semibold">Fastest</th>
                  <th className="px-2 text-right font-semibold">10th pct</th>
                  <th className="px-2 text-right font-semibold">Median</th>
                  <th className="px-2 text-right font-semibold">Average</th>
                  <th className="px-2 text-right font-semibold">90th pct</th>
                  <th className="px-2 text-right font-semibold">99th pct</th>
                  <th className="pl-2 text-right font-semibold">Slowest</th>
                </tr>
              </thead>
              <tbody>
                <SpeedRow label="All" latency={stats.latency} strong />
                <SpeedRow label={`Last ${stats.recentWindow}`} latency={stats.recentLatency} />
                <SpeedRow label="Buys" latency={stats.buy.latency} />
                <SpeedRow label="Sells" latency={stats.sell.latency} />
                {showModes ? <SpeedRow label="Raw" latency={raw.latency} /> : null}
                {showModes ? <SpeedRow label="Jito" latency={jito.latency} /> : null}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="pb-1 pr-3 text-left font-semibold">Attempts</th>
                  <th className="px-2 text-right font-semibold">Total</th>
                  <th className="px-2 text-right font-semibold">Landed</th>
                  <th className="px-2 text-right font-semibold">Refused</th>
                  <th className="px-2 text-right font-semibold">Never landed</th>
                  <th className="px-2 text-right font-semibold">Failed early</th>
                  <th className="px-2 text-right font-semibold">Retries</th>
                  <th className="pl-2 text-right font-semibold">Success</th>
                </tr>
              </thead>
              <tbody>
                <CountsRow label="All" c={t} />
                <CountsRow label="Buys" c={stats.buy} />
                <CountsRow label="Sells" c={stats.sell} />
                {showModes ? <CountsRow label="Raw" c={raw} /> : null}
                {showModes ? <CountsRow label="Jito" c={jito} /> : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            A failed buy is retried up to 3 times, quickly, and dropped if it can no longer be the trade the simulation took. A failed sell is retried up to 10 times; if it still fails, the position is flagged in red so it can be sold by hand.
          </p>

          {failedAttempts > 0 ? (
            <div className="space-y-1.5">
              <div className="text-xs font-extrabold tracking-wide text-muted-foreground uppercase">Recent failures</div>
              {stats.recentFailures.map((f, i) => (
                <div key={`${f.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg bg-secondary/40 px-3 py-1.5 text-[13px]">
                  <span className="font-bold">
                    {f.action === "buy" ? "Buy" : "Sell"} <span className="font-mono text-xs text-muted-foreground">{f.mint.slice(0, 4)}…{f.mint.slice(-4)}</span>
                    <span className="ml-2 font-normal text-negative">{OUTCOME_LABEL[f.outcome]}</span>
                    {f.attempt > 1 ? <span className="ml-2 text-xs font-normal text-muted-foreground">retry {f.attempt - 1}</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {f.error ? `${f.error.slice(0, 90)}${f.error.length > 90 ? "…" : ""} · ` : ""}
                    {formatRelativeTime(f.at)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
