"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, TriangleAlert } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { getTradingStats } from "@/lib/live-wallet-api";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Latency, TxCounts, TxStats } from "@/lib/live-wallet-types";

const POLL_MS = 15_000;
const RANGES = [
  { value: "all", label: "All time", hours: undefined },
  { value: "24", label: "24 hours", hours: 24 },
  { value: "1", label: "1 hour", hours: 1 },
] as const;

const th = "px-2 py-2 text-right text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";
const td = "px-2 py-2.5 text-right tabular-nums";

/** Milliseconds as "840 ms" or "2.31 s". */
function ms(value: number | null | undefined) {
  if (value == null) return "—";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function Tile({ label, value, hint, tone, help }: { label: string; value: string; hint?: string; tone?: "bad" | "good"; help?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
      <span className="text-xs text-text-3">
        {label}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </span>
      <b className={cn("truncate text-[18px] leading-6 font-semibold tabular-nums", tone === "bad" && "text-negative", tone === "good" && "text-positive")}>{value}</b>
      {hint ? <span className="truncate text-xs text-text-3">{hint}</span> : null}
    </div>
  );
}

function SpeedRow({ label, latency, strong }: { label: string; latency: Latency; strong?: boolean }) {
  return (
    <tr className={cn("border-t border-border", strong && "font-semibold")}>
      <td className="py-2.5 pr-3 pl-1 text-left text-text-2">{label}</td>
      <td className={td}>{latency.count}</td>
      <td className={td}>{ms(latency.minMs)}</td>
      <td className={td}>{ms(latency.p10Ms)}</td>
      <td className={td}>{ms(latency.p50Ms)}</td>
      <td className={td}>{ms(latency.avgMs)}</td>
      <td className={td}>{ms(latency.p90Ms)}</td>
      <td className={td}>{ms(latency.p99Ms)}</td>
      <td className={cn(td, "pr-1")}>{ms(latency.maxMs)}</td>
    </tr>
  );
}

function CountsRow({ label, c }: { label: string; c: TxCounts }) {
  return (
    <tr className="border-t border-border">
      <td className="py-2.5 pr-3 pl-1 text-left text-text-2">{label}</td>
      <td className={td}>{c.attempts}</td>
      <td className={cn(td, "text-positive")}>{c.success}</td>
      <td className={cn(td, c.reverted && "text-negative")}>{c.reverted}</td>
      <td className={cn(td, c.expired && "text-negative")}>{c.expired}</td>
      <td className={cn(td, c.error && "text-negative")}>{c.error}</td>
      <td className={td}>{c.retries}</td>
      <td className={cn(td, "pr-1")}>{c.successRate == null ? "—" : `${c.successRate.toFixed(0)}%`}</td>
    </tr>
  );
}

const OUTCOME_LABEL = { reverted: "refused by the program", expired: "never landed", error: "failed before landing" } as const;

/** How the wallet's transactions are doing: speed (build to landed), successes, failures and retries. */
export function TradingStats({ walletId, refreshKey }: { walletId: string; refreshKey: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["value"]>("all");
  const hours = RANGES.find((r) => r.value === range)?.hours;
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

  if (error && !stats)
    return (
      <div role="alert" className="rounded-[20px] border border-destructive/30 bg-neg-soft p-4 text-sm text-[#ffc9d0]">
        {error}
      </div>
    );
  if (!stats) return <Skeleton className="h-64 w-full rounded-[20px]" />;

  const t = stats.total;
  const failedAttempts = t.reverted + t.expired + t.error;
  const raw = stats.byMode.raw;
  const jito = stats.byMode.jito;
  const showModes = raw.attempts > 0 && jito.attempts > 0;

  return (
    <section className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <b className="flex items-center gap-2 text-[15px] font-semibold">
          <Gauge className="size-4 text-primary" />
          Transaction stats
          <HelpTip className="ml-0">Speed = time from a trade starting to be built until it is first seen on chain. Only real transactions count - a dry run sends nothing.</HelpTip>
        </b>
        <Segmented options={RANGES} value={range} onChange={setRange} label="Period" className="max-md:w-full" block={false} />
      </div>

      {t.attempts === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line-3 bg-card/50 px-6 py-8 text-center text-sm text-text-2">No real transactions in this period yet. Stats appear once the wallet trades live.</div>
      ) : (
        <>
          {stats.slowing ? (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                The last {stats.recentLatency.count} transactions took {ms(stats.recentLatency.p50Ms)} at the median, against {ms(stats.latency.p50Ms)} overall. Transactions are slowing down
                {raw.attempts > 0 && jito.attempts === 0 ? " - consider switching to Jito." : "."}
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            <Tile label="Median speed" value={ms(stats.latency.p50Ms)} hint={`${stats.latency.count} timed transactions`} />
            <Tile label="Fastest / slowest" value={`${ms(stats.latency.minMs)} / ${ms(stats.latency.maxMs)}`} />
            <Tile label="Success rate" value={t.successRate == null ? "—" : `${t.successRate.toFixed(1)}%`} hint={`${t.success} of ${t.attempts} attempts`} tone={t.successRate != null && t.successRate < 90 ? "bad" : "good"} />
            <Tile
              label="Retries"
              help="A failed buy is retried up to 3 times, quickly, and dropped if it can no longer be the trade the simulation took. A failed sell is retried up to 10 times; if it still fails, the position is flagged red for a manual sell."
              value={String(t.retries)}
              hint={`${t.tradesFailed} trade${t.tradesFailed === 1 ? "" : "s"} without a success`}
              tone={t.tradesFailed ? "bad" : undefined}
            />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border px-2">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr>
                  <th className={cn(th, "pl-1 text-left")}>Speed</th>
                  <th className={th}>Count</th>
                  <th className={th}>Fastest</th>
                  <th className={th}>10th pct</th>
                  <th className={th}>Median</th>
                  <th className={th}>Average</th>
                  <th className={th}>90th pct</th>
                  <th className={th}>99th pct</th>
                  <th className={cn(th, "pr-1")}>Slowest</th>
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

          <div className="overflow-x-auto rounded-xl border border-border px-2">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr>
                  <th className={cn(th, "pl-1 text-left")}>Attempts</th>
                  <th className={th}>Total</th>
                  <th className={th}>Landed</th>
                  <th className={th}>Refused</th>
                  <th className={th}>Never landed</th>
                  <th className={th}>Failed early</th>
                  <th className={th}>Retries</th>
                  <th className={cn(th, "pr-1")}>Success</th>
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

          {failedAttempts > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Recent failures</span>
              {stats.recentFailures.map((f, i) => (
                <div key={`${f.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[13px]">
                  <span className="font-semibold">
                    {f.action === "buy" ? "Buy" : "Sell"} <span className="font-mono text-xs font-normal text-text-3">{f.mint.slice(0, 4)}…{f.mint.slice(-4)}</span>
                    <span className="ml-2 font-normal text-negative">{OUTCOME_LABEL[f.outcome]}</span>
                    {f.attempt > 1 ? <span className="ml-2 text-xs font-normal text-text-3">retry {f.attempt - 1}</span> : null}
                  </span>
                  <span className="text-xs text-text-3">
                    {f.error ? `${f.error.slice(0, 90)}${f.error.length > 90 ? "…" : ""} · ` : ""}
                    {formatRelativeTime(f.at)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
