"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, Coins, ShieldAlert, TrendingDown, Wallet } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/traders/stat-tile";
import { getBacktestCombined, getBacktestViewWallet } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestCombinedWallet, BacktestViewWallet } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { axisLineStroke, axisTick, gridStroke, Note, Panel, tooltipClass } from "./parts";
import { Pill, formatDateTime, formatSignedPercent, pnlTone } from "./shared";
import { LossDepthCard } from "./loss-depth-card";
import { WorstStretchCard } from "./worst-stretch-card";

const DAY_MS = 86_400_000;
const shortDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });
const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

function BalanceChart({ data, starting, lostDays }: { data: BacktestCombinedWallet["curve"]; starting: number; lostDays: BacktestCombinedWallet["days"] }) {
  const up = (data.at(-1)?.balanceUsd ?? starting) >= starting;
  const color = up ? "var(--positive)" : "var(--negative)";
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="bt-combined-balance" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="0" stroke={gridStroke} vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tick={axisTick} axisLine={{ stroke: axisLineStroke }} tickLine={false} minTickGap={28} />
          <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => formatUsd(v)} tick={axisTick} axisLine={false} tickLine={false} width={68} />
          {lostDays.map((d) => {
            const from = Date.parse(`${d.date}T00:00:00Z`);
            return <ReferenceArea key={d.date} x1={from} x2={from + DAY_MS} fill="var(--negative)" fillOpacity={0.12} stroke="var(--negative)" strokeOpacity={0.4} strokeDasharray="3 4" ifOverflow="hidden" />;
          })}
          <ReferenceLine y={0} stroke="var(--negative)" strokeOpacity={0.5} />
          <ReferenceLine y={starting} stroke={axisLineStroke} strokeDasharray="4 4" />
          <ChartTooltip
            cursor={{ stroke: "var(--line-3)", strokeDasharray: "3 4" }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as { t: number; balanceUsd: number } | undefined) : undefined;
              if (!p) return null;
              return (
                <div className={tooltipClass}>
                  <div className="text-[13px] font-medium text-foreground">{formatDateTime(p.t)} UTC</div>
                  <div className="mt-1 text-text-2">
                    Balance: <b className={cn("font-semibold tabular-nums", p.balanceUsd < 0 ? "text-negative" : "text-foreground")}>{formatUsd(p.balanceUsd)}</b>
                  </div>
                </div>
              );
            }}
          />
          <Area type="stepAfter" dataKey="balanceUsd" stroke={color} strokeWidth={2} fill="url(#bt-combined-balance)" dot={false} activeDot={{ r: 5, fill: color, stroke: "var(--card)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DailyPnlChart({ days }: { days: BacktestCombinedWallet["days"] }) {
  const lostDays = days.filter((d) => d.lostCapital);
  const data = days.map((d) => ({ date: d.date, pnlUsd: d.pnlUsd, trades: d.trades, lost: d.lostCapital }));
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="0" stroke={gridStroke} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={axisTick} axisLine={{ stroke: axisLineStroke }} tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={(v: number) => formatUsd(v)} tick={axisTick} axisLine={false} tickLine={false} width={68} />
          <ReferenceLine y={0} stroke={axisLineStroke} />
          {lostDays.map((d) => (
            <ReferenceDot key={d.date} x={d.date} y={0} r={5} fill="var(--negative)" stroke="var(--card)" strokeWidth={2} ifOverflow="visible" />
          ))}
          <ChartTooltip
            cursor={{ fill: "var(--surface-3)", opacity: 0.5 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as { date: string; pnlUsd: number; trades: number; lost: boolean } | undefined) : undefined;
              if (!p) return null;
              return (
                <div className={tooltipClass}>
                  <div className="text-[13px] font-medium text-foreground">{p.date}</div>
                  <div className="mt-1 text-text-2">
                    P&amp;L: <b className={cn("font-semibold tabular-nums", pnlTone(p.pnlUsd))}>{formatUsd(p.pnlUsd)}</b>
                  </div>
                  <div className="text-text-2">
                    {p.trades} trade{p.trades === 1 ? "" : "s"}
                  </div>
                  {p.lost && <div className="text-negative">Balance ran out this day</div>}
                </div>
              );
            }}
          />
          <Bar dataKey="pnlUsd" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.pnlUsd >= 0 ? "var(--positive)" : "var(--negative)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The shared wallet of a combined backtest: every address's trades added up on ONE balance in the order they happened. Refetches whenever
 * `refreshKey` changes, so it follows the backtest while it runs. With `viewId` it shows a combined VIEW of the backtest instead (same wallet,
 * worked out from the backtest's stored trades re-priced with the view's own amount and fees); `onLoaded` hands the view's full answer to the page.
 */
export function CombinedWalletPanel({ runId, viewId, refreshKey = 0, onLoaded }: { runId: string; viewId?: string; refreshKey?: number; onLoaded?: (wallet: BacktestViewWallet) => void }) {
  const [data, setData] = useState<BacktestCombinedWallet | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const loaded = useRef(onLoaded);
  useEffect(() => {
    loaded.current = onLoaded;
  });

  useEffect(() => {
    let cancelled = false;
    const load: Promise<BacktestCombinedWallet> = viewId ? getBacktestViewWallet(runId, viewId).then((res) => (loaded.current?.(res), res)) : getBacktestCombined(runId);
    load
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load the combined wallet"));
    return () => {
      cancelled = true;
    };
  }, [runId, viewId, refreshKey]);

  const totals = useMemo(() => {
    if (!data) return null;
    return data.days.reduce(
      (acc, d) => ({ pnlUsd: acc.pnlUsd + d.pnlUsd, trades: acc.trades + d.trades, wins: acc.wins + d.wins, losses: acc.losses + d.losses, negativeEvents: acc.negativeEvents + d.negativeEvents, notTaken: acc.notTaken + d.notTaken }),
      { pnlUsd: 0, trades: 0, wins: 0, losses: 0, negativeEvents: 0, notTaken: 0 }
    );
  }, [data]);

  if (!data || !totals) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full rounded-[20px]" />
        <Skeleton className="h-60 w-full rounded-[20px]" />
      </div>
    );
  }

  const { config, wallet, days } = data;
  const reset = config.resetDaily;
  const returnPercent = config.startingBalanceUsd > 0 ? (wallet.realizedPnlUsd / config.startingBalanceUsd) * 100 : 0;
  const hasTrades = wallet.closedPositionCount + wallet.openPositionCount > 0;
  const tradedDays = days.filter((d) => d.trades > 0).length;

  const pills = (
    <div className="flex flex-wrap gap-2">
      <Pill tone={wallet.negativeBalanceEventCount > 0 ? "neg" : "neutral"}>
        {wallet.negativeBalanceEventCount > 0
          ? `Went negative · ${wallet.negativeBalanceEventCount.toLocaleString()} time${wallet.negativeBalanceEventCount === 1 ? "" : "s"} · deepest ${formatUsd(-wallet.maxNegativeBalanceUsd)} · ${wallet.negativeDays} day${wallet.negativeDays === 1 ? "" : "s"}`
          : config.allowNegativeBalance
            ? "Never went negative"
            : `${wallet.notTakenCount.toLocaleString()} buy${wallet.notTakenCount === 1 ? "" : "s"} not taken for lack of balance`}
      </Pill>
      <Pill>
        Loss days · {wallet.lossDays} / {tradedDays} ({wallet.profitDays} profit)
      </Pill>
      <Pill>Win rate · {wallet.winRatePercent != null ? `${wallet.winRatePercent.toFixed(0)}%` : "—"} · {wallet.wins.toLocaleString()}W / {wallet.losses.toLocaleString()}L</Pill>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <Note>
        {formatUsd(config.startingBalanceUsd)} start · {formatUsd(config.tradeAmountUsd)} per trade · fees {config.pumpFeePercent}% + {formatUsd(config.jitoFeeUsd)} ·{" "}
        {reset ? "balance resets every UTC day (a trade counts for the day it was entered)" : "one balance through the whole window"} ·{" "}
        {config.allowNegativeBalance ? "balance may go negative" : "a buy the balance cannot pay is not taken"}
        {!data.complete && " · still being worked on, so these figures cover only the trades simulated so far"}
      </Note>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile
          label={reset ? "Balance at end of last day" : "Final balance"}
          value={formatUsd(wallet.balanceUsd)}
          icon={Wallet}
          tone={wallet.balanceUsd > config.startingBalanceUsd ? "positive" : wallet.balanceUsd < config.startingBalanceUsd ? "negative" : "default"}
          hint={wallet.walletValueUsd != null && wallet.openPositionCount > 0 ? `${formatUsd(wallet.walletValueUsd)} with ${wallet.openPositionCount} open trade${wallet.openPositionCount === 1 ? "" : "s"} valued` : "cash, started from " + formatUsd(config.startingBalanceUsd)}
        />
        <StatTile
          label="Realized P&L"
          value={formatUsd(wallet.realizedPnlUsd)}
          icon={Coins}
          tone={wallet.realizedPnlUsd > 0 ? "positive" : wallet.realizedPnlUsd < 0 ? "negative" : "default"}
          hint={`${formatSignedPercent(returnPercent)} of the start${reset ? " (summed over the days)" : ""}`}
        />
        <StatTile
          label="Capital-loss start days"
          value={`${wallet.lostCapitalDays} / ${wallet.testedStartDays}`}
          icon={ShieldAlert}
          tone={wallet.lostCapitalDays > 0 ? "negative" : wallet.testedStartDays > 0 ? "positive" : "default"}
          hint={
            wallet.testedStartDays === 0
              ? "no trades yet"
              : wallet.lostCapitalDays === 0
                ? reset
                  ? "no day ran out of balance"
                  : "starting on any day with trades would have survived"
                : `starting on ${wallet.lostCapitalDays === 1 ? "that day" : "any of those days"} would have run the balance out`
          }
        />
        <StatTile label="Lowest balance" value={formatUsd(wallet.lowestBalanceUsd)} icon={TrendingDown} tone={wallet.lowestBalanceUsd < 0 ? "negative" : "default"} hint={reset ? "lowest point of any day" : "lowest point of the whole window"} />
      </div>

      {/* Wide screens: the three smaller facts as pills; phones fold them into one row. */}
      <div className="max-md:hidden">{pills}</div>
      <div className="overflow-hidden rounded-[16px] border border-border bg-card md:hidden">
        <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[15px] font-semibold">More numbers</b>
            <span className="text-xs text-text-3">Went negative · loss days · win rate</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", moreOpen && "rotate-180")} />
        </button>
        {moreOpen && <div className="border-t border-border px-4 py-3">{pills}</div>}
      </div>

      <div className="grid gap-4 md:gap-5 xl:grid-cols-2">
        <LossDepthCard depth={data.lossDepth} />
        <WorstStretchCard stretch={data.worstStretch} />
      </div>

      <Panel
        title={reset ? "Profit and loss of each day" : "Balance over time"}
        aside={hasTrades && wallet.lostCapitalDays > 0 ? "Red dots mark days on which starting the wallet would have run its balance out" : undefined}
      >
        {!hasTrades ? (
          <div className="flex h-60 items-center justify-center px-4 text-center text-sm text-text-2">No trades yet - the chart fills in as trades finish.</div>
        ) : reset ? (
          <DailyPnlChart days={days} />
        ) : (
          <BalanceChart data={data.curve} starting={config.startingBalanceUsd} lostDays={days.filter((d) => d.lostCapital)} />
        )}
        {hasTrades && wallet.lostCapitalDays > 0 && !reset && (
          <p className="flex items-center gap-2 text-xs text-text-3">
            <span className="inline-block size-2.5 shrink-0 rounded-sm bg-negative/30 ring-1 ring-negative/50" />
            <span>
              Red bands mark the {wallet.lostCapitalDays} day{wallet.lostCapitalDays === 1 ? "" : "s"} on which starting the wallet would have run its balance out (it can survive from day one and still have bad days to start on).
            </span>
          </p>
        )}
      </Panel>

      <section className="flex flex-col gap-3 md:gap-0 md:overflow-hidden md:rounded-[20px] md:border md:border-border md:bg-card">
        <div className="flex items-center justify-between gap-3 px-1 md:border-b md:border-border md:px-5 md:py-4">
          <b className="text-[15px] font-semibold">Day by day</b>
          <span className="text-xs text-text-3 md:hidden">If started this day</span>
        </div>

        {/* Phone: one card per day. */}
        <div className="flex flex-col gap-3 md:hidden">
          {days.map((d) => (
            <article key={d.date} className={cn("flex flex-col gap-1.5 rounded-2xl border bg-surface-2 p-3.5", d.lostCapital ? "border-destructive/30 bg-neg-soft" : "border-border")}>
              <div className="flex items-center justify-between">
                <b className="text-sm font-semibold">
                  {new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} {d.date.slice(5)}
                </b>
                <b className={cn("font-semibold tabular-nums", pnlTone(d.pnlUsd))}>{d.trades > 0 ? formatUsd(d.pnlUsd) : "—"}</b>
              </div>
              <div className="flex items-center justify-between text-xs text-text-3">
                <span>{d.trades > 0 ? `${d.trades} trade${d.trades === 1 ? "" : "s"}` : "no trades"}</span>
                {!d.testedStart ? null : d.lostCapital ? (
                  <span className="text-negative">
                    Loses capital
                    {d.lostAt != null ? ` after ${((d.lostAt - Date.parse(`${d.date}T00:00:00Z`)) / DAY_MS).toFixed(1)} days to ${formatUsd(d.lostBalanceUsd ?? 0)}` : ""}
                  </span>
                ) : (
                  <span className="text-positive">Survives</span>
                )}
              </div>
            </article>
          ))}
        </div>

        {/* Wide screens: the table. */}
        <div className="max-md:hidden">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className={cn(headCls, "pl-5")}>Day (UTC)</TableHead>
                <TableHead className={cn(headCls, "text-right")}>Started at</TableHead>
                <TableHead className={cn(headCls, "text-right")}>Ended at</TableHead>
                <TableHead className={cn(headCls, "text-right")}>Lowest</TableHead>
                <TableHead className={cn(headCls, "text-right")}>P&amp;L</TableHead>
                <TableHead className={cn(headCls, "text-right")}>Trades</TableHead>
                <TableHead className={cn(headCls, "text-right")}>Went negative</TableHead>
                <TableHead className={cn(headCls, "pr-5 text-right")}>If started this day</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d.date} className={cn("h-[52px] border-border", d.lostCapital && "bg-neg-soft hover:bg-neg-soft")}>
                  <TableCell className="pl-5 text-[13px] whitespace-nowrap">
                    {new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} <span className="text-text-3">{d.date.slice(5)}</span>
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{formatUsd(d.startBalanceUsd)}</TableCell>
                  <TableCell className={cn("text-right text-[13px] tabular-nums", d.endBalanceUsd < 0 && "text-negative")}>{formatUsd(d.endBalanceUsd)}</TableCell>
                  <TableCell className={cn("text-right text-[13px] tabular-nums", d.lowestBalanceUsd < 0 && "text-negative")}>{formatUsd(d.lowestBalanceUsd)}</TableCell>
                  <TableCell className={cn("text-right text-[13px] font-semibold tabular-nums", pnlTone(d.pnlUsd))}>{d.trades > 0 ? formatUsd(d.pnlUsd) : "—"}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">
                    {d.trades > 0 ? (
                      <>
                        {d.trades} <span className="text-xs text-text-3">{d.wins}W/{d.losses}L</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className={cn("text-right text-[13px] tabular-nums", d.negativeEvents > 0 && "text-negative")}>
                    {d.negativeEvents > 0 ? (
                      <>
                        {d.negativeEvents}× <span className="text-xs">to {formatUsd(-d.maxNegativeDepthUsd)}</span>
                      </>
                    ) : d.notTaken > 0 ? (
                      <span className="text-xs text-text-3">{d.notTaken} not taken</span>
                    ) : (
                      <span className="text-text-3">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-right text-[13px] tabular-nums">
                    {!d.testedStart ? (
                      <span className="text-text-3">—</span>
                    ) : d.lostCapital ? (
                      <span className="inline-flex flex-col items-end leading-[1.3] text-negative">
                        <b className="font-semibold">Loses capital</b>
                        {d.lostAt != null && (
                          <span className="text-xs">
                            after {((d.lostAt - Date.parse(`${d.date}T00:00:00Z`)) / DAY_MS).toFixed(1)} days · to {formatUsd(d.lostBalanceUsd ?? 0)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <b className="font-semibold text-positive">Survives</b>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="bg-transparent">
              <TableRow className="h-14 border-line-2 hover:bg-transparent">
                <TableCell className="pl-5 text-[13px] font-semibold">Total</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className={cn("text-right text-[13px] tabular-nums", wallet.lowestBalanceUsd < 0 && "text-negative")}>{formatUsd(wallet.lowestBalanceUsd)}</TableCell>
                <TableCell className={cn("text-right text-[13px] font-semibold tabular-nums", pnlTone(totals.pnlUsd))}>{formatUsd(totals.pnlUsd)}</TableCell>
                <TableCell className="text-right text-[13px] tabular-nums">
                  {totals.trades} <span className="text-xs text-text-3">{totals.wins}W/{totals.losses}L</span>
                </TableCell>
                <TableCell className={cn("text-right text-[13px] tabular-nums", totals.negativeEvents > 0 && "text-negative")}>{totals.negativeEvents > 0 ? `${totals.negativeEvents}×` : "—"}</TableCell>
                <TableCell className={cn("pr-5 text-right text-[13px] tabular-nums", wallet.lostCapitalDays > 0 && "text-negative")}>
                  {wallet.lostCapitalDays} / {wallet.testedStartDays} lose
                  <HelpTip>
                    Each day is its own wallet that starts from the starting balance; a trade counts for the day it was entered, even if it was sold after midnight. The last column replays only the trades entered from that day on, from the starting balance: the capital is lost when the balance could not pay a buy at some point.
                  </HelpTip>
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </section>
    </div>
  );
}
