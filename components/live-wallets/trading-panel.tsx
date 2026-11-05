"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, Flame, Loader2, Table2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatBox, signedUsd, toneClass } from "./shared";
import { DryRunComparison } from "./dry-run-comparison";
import { TradingConnection } from "./trading-connection";
import { TradingLots } from "./trading-lots";
import { TradingStats } from "./trading-stats";
import { burnEmptyAccounts, createLookupTable, getDryDaily, getTradingState, getTradingSummary } from "@/lib/live-wallet-api";
import { formatRelativeTime, formatSol, formatUsd } from "@/lib/format";
import { styleLabel } from "@/lib/live-wallet-styles";
import { cn } from "@/lib/utils";
import type { DryDaily, TradingState, TradingSummary } from "@/lib/live-wallet-types";

const POLL_MS = 10_000;

/**
 * One line of the chart. Live and Simulation keep the colours they always had (the app's primary and a neutral dashed reference). The exit ways take the
 * documented categorical hues in their fixed order, minus blue - Live's violet-blue already sits there on the colour wheel and the two could not be told apart
 * (checked with the palette validator on the card surface #16152a: every pair passes, the dimmest line is 3.6:1). A colour belongs to the way, not to its
 * position: own / follow / API Plus always have the same one, the cool-downs take the next ones in order of length. A way past the sixth colour is a neutral
 * grey told apart by its dash pattern instead (a generated seventh hue would be indistinguishable).
 */
type ChartLine = { key: string; label: string; color: string; width: number; dash?: string };
const WAY_COLORS = ["#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#e66767"];
const SPARE_DASHES = ["2 3", "8 3 2 3", "1 4"];

function wayLines(daily: DryDaily): ChartLine[] {
  const used = daily.styles.filter((s) => s.trades > 0);
  const cooldowns = used.filter((s) => /^cd\d+$/.test(s.id)).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
  const fixed: Record<string, number> = { own: 0, follow: 1, apiplus: 2 };
  const out: ChartLine[] = [];
  let spare = 0;
  const place = (id: string, index: number) => {
    const color = WAY_COLORS[index];
    out.push({ key: `way_${id}`, label: styleLabel(id), color: color ?? "#9a97b3", width: 2, dash: color ? undefined : SPARE_DASHES[spare++ % SPARE_DASHES.length] });
  };
  for (const s of used) if (s.id in fixed) place(s.id, fixed[s.id]);
  cooldowns.forEach((s, i) => place(s.id, 3 + i));
  for (const s of used) if (!(s.id in fixed) && !cooldowns.includes(s)) place(s.id, WAY_COLORS.length); // a style this screen has not heard of
  return out;
}

const HIDDEN_KEY = (walletId: string) => `pft.live-chart.hidden.${walletId}`;
const readHidden = (walletId: string): Set<string> => {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY(walletId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
};
const saveHidden = (walletId: string, hidden: Set<string>) => {
  try {
    window.localStorage.setItem(HIDDEN_KEY(walletId), JSON.stringify([...hidden]));
  } catch {
    // a private window or blocked storage: the choice just is not remembered
  }
};

const money = (n: number) => Number(n.toFixed(2));

/** One row per day: Live and Simulation as they were (running totals), and each exit way's running total over the last 7 days. */
function buildRows(summary: TradingSummary, daily: DryDaily | null, ways: ChartLine[]) {
  const live = new Map(summary.series.map((p) => [p.date, p]));
  const dates = [...new Set([...summary.series.map((p) => p.date), ...(daily?.days ?? [])])].sort();
  const running = new Map<string, Map<string, number>>();
  for (const line of ways) {
    const style = daily?.styles.find((s) => `way_${s.id}` === line.key);
    const byDay = new Map<string, number>();
    let total = 0;
    for (const d of style?.days ?? []) {
      total += d.pnlUsd;
      byDay.set(d.date, money(total));
    }
    running.set(line.key, byDay);
  }
  let carried: { live: number; sim: number } | null = null; // a running total stands over the days with no closed trade
  return dates.map((date) => {
    const p = live.get(date);
    if (p) carried = { live: money(p.livePnlUsd), sim: money(p.simPnlUsd) };
    const row: Record<string, number | string | null> = { date: date.slice(5), live: carried?.live ?? null, sim: carried?.sim ?? null };
    for (const line of ways) row[line.key] = running.get(line.key)?.get(date) ?? null;
    return row;
  });
}

function SeriesChart({ walletId, summary }: { walletId: string; summary: TradingSummary }) {
  const [daily, setDaily] = useState<DryDaily | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : readHidden(walletId)));

  // What each exit way made per day. It changes when a way decides, which is not always when the summary changes, so it is also refreshed on a timer.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getDryDaily(walletId)
        .then((d) => !cancelled && setDaily(d))
        .catch(() => {});
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [walletId, summary.dry.closed, summary.dryResetAt]);

  const ways = daily ? wayLines(daily) : [];
  const lines: ChartLine[] = [
    { key: "live", label: "Live (cumulative)", color: "var(--primary)", width: 2.5 },
    { key: "sim", label: "Simulation, same trades", color: "var(--muted-foreground)", width: 2, dash: "5 4" },
    ...ways,
  ];
  const rows = buildRows(summary, daily, ways);
  if (rows.length < 2) return null;

  const shown = lines.filter((l) => !hidden.has(l.key));
  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    saveHidden(walletId, next);
  };
  const showAll = () => {
    setHidden(new Set());
    saveHidden(walletId, new Set());
  };

  return (
    <Card className="gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-extrabold">Profit over time</div>
        {hidden.size > 0 ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground" onClick={showAll}>
            <Eye className="size-3.5" /> Show all lines
          </Button>
        ) : null}
      </div>
      <div className="h-56 w-full sm:h-64" role="img" aria-label={`Profit over time, running total in dollars: ${shown.map((l) => l.label).join(", ") || "no line shown"}`}>
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">Every line is hidden - tap a name below to show it.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }}
                cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.4 }}
                itemSorter={(item) => -(Number(item.value) || 0)}
                formatter={(value) => formatUsd(Number(value))}
              />
              {shown.map((l) => (
                <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash} dot={false} activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lines on the chart">
        {lines.map((l) => {
          const on = !hidden.has(l.key);
          return (
            <button
              key={l.key}
              type="button"
              onClick={() => toggle(l.key)}
              aria-pressed={on}
              title={on ? "Click to hide this line" : "Click to show this line"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                on ? "border-border bg-secondary/60 text-foreground hover:border-primary/60" : "border-dashed border-border text-muted-foreground line-through hover:text-foreground"
              )}
            >
              <span className={cn("h-0 w-4 border-t-2", !on && "opacity-40")} style={{ borderColor: l.color, borderTopStyle: l.dash ? "dashed" : "solid" }} />
              {l.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Live and Simulation are running totals over all closed trades. The exit ways are the dry run&apos;s own results over the last 7 days (since the reset), counted on the day each one sold - see the table above for the numbers.
      </p>
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

function LookupTableCard({ walletId, state, onDone }: { walletId: string; state: TradingState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const has = !!state.lookupTable;

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await createLookupTable(walletId);
      toast.success(r.added > 0 ? `Lookup table ready: ${r.total} accounts (${r.added} added)` : "The lookup table already has everything it needs");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the lookup table");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-brand-soft">
          <Table2 className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold">Lookup table</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            A table of the accounts pump.fun trades use, owned by this wallet. It lets the bigger swaps (paying with SOL for tokens quoted in USDC, PUMP and so on) fit in one transaction. Create it now so the first trade doesn&apos;t have to wait for it. It costs about 0.01-0.02 SOL of rent (refundable by closing the table) plus a few network fees, and takes up to a minute. Clicking again tops it up. (Needs 0.001 SOL in the wallet to create it, 0.005 SOL to update it.)
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {has ? (
              <>
                Created: <span className="font-mono">{state.lookupTable!.slice(0, 6)}…{state.lookupTable!.slice(-4)}</span>
                {state.lookupTableAddresses != null ? `, ${state.lookupTableAddresses} accounts` : ""}.
              </>
            ) : (
              "Not created yet - it is made by the first trade that needs it."
            )}
          </p>
        </div>
      </div>
      <Button variant="outline" className="w-fit gap-2" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Table2 className="size-4" />}
        {busy ? "Creating…" : has ? "Update lookup table" : "Create lookup table"}
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
        key={[state.connected, state.tradingMode, state.buySlippagePercent, state.sellSlippagePercent, state.tradeDelaySeconds, state.sendMode, state.jitoTipUsd, state.scaleJitoFee, state.rawPriorityMicroLamports, state.tradeRatioSim, state.tradeRatioLive, state.paused].join("-")}
        walletId={walletId}
        state={state}
        twoFactorEnabled={twoFactorEnabled}
        onChange={(next) => {
          setState(next);
          void load();
        }}
      />

      <LookupTableCard walletId={walletId} state={state} onDone={load} />

      {state.connected ? (
        <>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatBox label="Live profit (finished)" value={s ? signedUsd(s.livePnlUsd) : "-"} className={toneClass(s?.livePnlUsd)} hint={s ? `${s.trades} trade${s.trades === 1 ? "" : "s"}${s.liveWinRate != null ? ` · ${s.liveWinRate.toFixed(0)}% winning` : ""}` : "no real trade finished yet"} />
            <StatBox label={state.tradeRatioLive === state.tradeRatioSim ? "Simulation, same trades" : "Simulation, same trades, at live size"} value={s ? signedUsd(s.simPnlUsd) : "-"} className={toneClass(s?.simPnlUsd)} hint={s && s.pairedTrades < s.trades ? `${s.pairedTrades} of ${s.trades} have a simulated twin` : undefined} />
            <StatBox label="Live minus simulation" value={difference != null ? signedUsd(difference) : "-"} className={toneClass(difference)} />
            <StatBox label="Open positions" value={String(open)} hint={summary ? `${summary.live.open} live · ${summary.dry.open} dry run` : undefined} />
          </div>
          {s ? (
            <p className="-mt-1 text-xs text-muted-foreground">
              Costs already included in the live result: Jito tips {formatUsd(s.tipsPaidUsd)}, network fees {formatUsd(s.networkFeesPaidUsd)}{s.assumedTipsUsd > 0 ? `, and ${formatUsd(s.assumedTipsUsd)} of assumed Jito fees (counted as the simulation does, but never spent because the wallet sends raw)` : ""}. The deposit for a token account is not a cost - it stays in the wallet&apos;s balance until the account is burned.
            </p>
          ) : null}

          {summary ? <DryRunComparison walletId={walletId} summary={summary} onReset={load} /> : null}
          {summary ? <SeriesChart walletId={walletId} summary={summary} /> : null}
          <TradingStats walletId={walletId} refreshKey={refreshKey} />
          <BurnEngineCard walletId={walletId} state={state} onDone={load} />
          <div className="text-[15px] font-extrabold">Trades side by side</div>
          <TradingLots walletId={walletId} exitMode={state.exitMode} refreshKey={refreshKey} />
        </>
      ) : null}
    </div>
  );
}
