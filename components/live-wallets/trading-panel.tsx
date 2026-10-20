"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatBox, signedUsd, toneClass } from "./shared";
import { TradingConnection } from "./trading-connection";
import { TradingLots } from "./trading-lots";
import { burnEmptyAccounts, getTradingState, getTradingSummary } from "@/lib/live-wallet-api";
import { formatRelativeTime, formatSol, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TradingState, TradingSummary } from "@/lib/live-wallet-types";

const POLL_MS = 10_000;

function Comparison({ summary }: { summary: TradingSummary }) {
  const d = summary.dryComparison;
  if (!d) return null;
  const better = d.ownPnlUsd === d.followPnlUsd ? null : d.ownPnlUsd > d.followPnlUsd ? "own" : "follow";
  return (
    <Card className="gap-3 p-5">
      <div>
        <div className="text-[15px] font-extrabold">Dry run: which exit way is better?</div>
        <p className="mt-1 text-[13px] text-muted-foreground">Over {d.trades} finished dry-run trade{d.trades === 1 ? "" : "s"}, the same entries exited two ways.</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {(
          [
            { key: "own", label: "Its own entry", pnl: d.ownPnlUsd, win: d.ownWinRate },
            { key: "follow", label: "Follow simulation", pnl: d.followPnlUsd, win: d.followWinRate },
          ] as const
        ).map((x) => (
          <div key={x.key} className={cn("rounded-xl border p-3", better === x.key ? "border-positive/40 bg-positive/5" : "border-border bg-secondary/40")}>
            <div className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground">
              {x.label}
              {better === x.key ? <span className="text-positive">better</span> : null}
            </div>
            <div className={cn("mt-1 text-xl font-extrabold tabular-nums", toneClass(x.pnl))}>{signedUsd(x.pnl)}</div>
            <div className="text-xs text-muted-foreground">{x.win.toFixed(0)}% winning</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SeriesChart({ summary }: { summary: TradingSummary }) {
  if (summary.series.length < 2) return null;
  const data = summary.series.map((p) => ({ date: p.date.slice(5), Live: Number(p.livePnlUsd.toFixed(2)), Simulation: Number(p.simPnlUsd.toFixed(2)) }));
  return (
    <Card className="gap-3 p-5">
      <div className="text-[15px] font-extrabold">Profit over time</div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
              formatter={(value) => formatUsd(Number(value))}
            />
            <Line type="monotone" dataKey="Live" stroke="var(--primary)" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="Simulation" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-primary" /> Live (cumulative)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-muted-foreground" /> Simulation, same trades
        </span>
      </div>
    </Card>
  );
}

function BurnEngineCard({ walletId, state, onDone }: { walletId: string; state: TradingState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const live = state.tradingMode === "live";

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await burnEmptyAccounts(walletId);
      if (r.closed === 0) toast.message(r.failed ? `${r.failed} account(s) couldn't be closed` : "No empty token accounts to close");
      else toast.success(`Closed ${r.closed} empty token account${r.closed === 1 ? "" : "s"}, ${formatSol(r.reclaimedLamports / 1e9)} returned to the wallet`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The sweep failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-negative/15 text-negative">
          <Flame className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold">Empty token account cleanup</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Every {state.burnSweepEveryMinutes} minutes, token accounts holding {state.emptyTokenLimit} tokens or fewer are burned and closed, and their deposit comes back to the wallet. It uses a normal low-fee transaction (not Jito), up to 10 accounts at a time, and never touches a token with an open position.
            {live ? "" : " It runs only while the wallet is trading live."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{state.lastBurnSweepAt ? `Last checked ${formatRelativeTime(state.lastBurnSweepAt)}.` : "Not checked yet."}</p>
        </div>
      </div>
      <Button variant="outline" className="w-fit gap-2" onClick={run} disabled={busy || !live}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4 text-negative" />}
        Clean up now
      </Button>
    </Card>
  );
}

/** The "Copy trading" tab of a live wallet: connection, switches, totals, the trades side by side, and the cleanup engine. */
export function TradingPanel({ walletId, twoFactorEnabled, refreshKey }: { walletId: string; twoFactorEnabled: boolean; refreshKey: number }) {
  const [state, setState] = useState<TradingState | null>(null);
  const [summary, setSummary] = useState<TradingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, sum] = await Promise.all([getTradingState(walletId), getTradingSummary(walletId)]);
      setState(s);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load copy trading");
    }
  }, [walletId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  if (error && !state) return <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>;
  if (!state) return <Skeleton className="h-72 w-full rounded-2xl" />;

  const s = summary?.settled;
  const difference = s ? s.livePnlUsd - s.simPnlUsd : null;
  const open = (summary?.live.open ?? 0) + (summary?.dry.open ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <TradingConnection
        key={`${state.connected}-${state.tradingMode}-${state.buySlippagePercent}-${state.sellSlippagePercent}`}
        walletId={walletId}
        state={state}
        twoFactorEnabled={twoFactorEnabled}
        onChange={(next) => {
          setState(next);
          void load();
        }}
      />

      {state.connected ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatBox label="Live profit (finished)" value={s ? signedUsd(s.livePnlUsd) : "-"} className={toneClass(s?.livePnlUsd)} hint={s ? `${s.trades} trade${s.trades === 1 ? "" : "s"}${s.liveWinRate != null ? ` · ${s.liveWinRate.toFixed(0)}% winning` : ""}` : "no real trade finished yet"} />
            <StatBox label="Simulation, same trades" value={s ? signedUsd(s.simPnlUsd) : "-"} className={toneClass(s?.simPnlUsd)} hint={s && s.pairedTrades < s.trades ? `${s.pairedTrades} of ${s.trades} have a simulated twin` : undefined} />
            <StatBox label="Live minus simulation" value={difference != null ? signedUsd(difference) : "-"} className={toneClass(difference)} />
            <StatBox label="Open positions" value={String(open)} hint={summary ? `${summary.live.open} live · ${summary.dry.open} dry run` : undefined} />
          </div>
          {s ? (
            <p className="-mt-1 text-xs text-muted-foreground">
              Costs already included in the live result: Jito tips {formatUsd(s.tipsPaidUsd)} and network fees {formatUsd(s.networkFeesPaidUsd)}. The deposit for a token account is not a cost - it stays in the wallet&apos;s balance until the account is burned.
            </p>
          ) : null}

          {summary ? <Comparison summary={summary} /> : null}
          {summary ? <SeriesChart summary={summary} /> : null}
          <BurnEngineCard walletId={walletId} state={state} onDone={load} />
          <div className="text-[15px] font-extrabold">Trades side by side</div>
          <TradingLots walletId={walletId} exitMode={state.exitMode} refreshKey={refreshKey} />
        </>
      ) : null}
    </div>
  );
}
