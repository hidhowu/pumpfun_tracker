"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CalendarDays, Coins, Target, TrendingDown, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/traders/stat-tile";
import { getBacktestCombined } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestCombinedWallet } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { formatDateTime, formatSignedPercent, pnlTone } from "./shared";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };
const shortDate = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" });

function BalanceChart({ data, starting }: { data: BacktestCombinedWallet["curve"]; starting: number }) {
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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortDate} tick={axisTick} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={28} />
          <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => formatUsd(v)} tick={axisTick} axisLine={false} tickLine={false} width={68} />
          <ReferenceLine y={0} stroke="var(--negative)" strokeOpacity={0.5} />
          <ReferenceLine y={starting} stroke="var(--border)" strokeDasharray="4 4" />
          <ChartTooltip
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as { t: number; balanceUsd: number } | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
                  <div className="font-medium text-foreground">{formatDateTime(p.t)} UTC</div>
                  <div className="mt-1 text-muted-foreground">
                    Balance: <span className={p.balanceUsd < 0 ? "text-negative" : "text-foreground"}>{formatUsd(p.balanceUsd)}</span>
                  </div>
                </div>
              );
            }}
          />
          <Area type="stepAfter" dataKey="balanceUsd" stroke={color} strokeWidth={2} fill="url(#bt-combined-balance)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DailyPnlChart({ days }: { days: BacktestCombinedWallet["days"] }) {
  const data = days.map((d) => ({ date: d.date, pnlUsd: d.pnlUsd, trades: d.trades }));
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={axisTick} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={12} />
          <YAxis tickFormatter={(v: number) => formatUsd(v)} tick={axisTick} axisLine={false} tickLine={false} width={68} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as { date: string; pnlUsd: number; trades: number } | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
                  <div className="font-medium text-foreground">{p.date}</div>
                  <div className="mt-1 text-muted-foreground">
                    P&amp;L: <span className={pnlTone(p.pnlUsd)}>{formatUsd(p.pnlUsd)}</span>
                  </div>
                  <div className="text-muted-foreground">{p.trades} trade{p.trades === 1 ? "" : "s"}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="pnlUsd" radius={[3, 3, 0, 0]}>
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
 * `refreshKey` changes, so it follows the backtest while it runs.
 */
export function CombinedWalletPanel({ runId, refreshKey = 0 }: { runId: string; refreshKey?: number }) {
  const [data, setData] = useState<BacktestCombinedWallet | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBacktestCombined(runId)
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load the combined wallet"));
    return () => {
      cancelled = true;
    };
  }, [runId, refreshKey]);

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
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  const { config, wallet, days } = data;
  const reset = config.resetDaily;
  const returnPercent = config.startingBalanceUsd > 0 ? (wallet.realizedPnlUsd / config.startingBalanceUsd) * 100 : 0;
  const hasTrades = wallet.closedPositionCount + wallet.openPositionCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {formatUsd(config.startingBalanceUsd)} start · {formatUsd(config.tradeAmountUsd)} per trade · fees {config.pumpFeePercent}% + {formatUsd(config.jitoFeeUsd)} ·{" "}
        {reset ? "balance resets every UTC day (a trade counts for the day it was entered)" : "one balance through the whole window"} ·{" "}
        {config.allowNegativeBalance ? "balance may go negative" : "a buy the balance cannot pay is not taken"}
        {!data.complete && " · still being worked on, so these figures cover only the trades simulated so far"}
      </p>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <StatTile
          label={reset ? "Balance at the end of the last day" : "Final balance"}
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
          hint={`${formatSignedPercent(returnPercent)} of the starting balance${reset ? " (summed over the days)" : ""}`}
        />
        <StatTile
          label="Went negative"
          value={`${wallet.negativeBalanceEventCount.toLocaleString()} time${wallet.negativeBalanceEventCount === 1 ? "" : "s"}`}
          icon={AlertTriangle}
          tone={wallet.negativeBalanceEventCount > 0 ? "negative" : "default"}
          hint={
            wallet.negativeBalanceEventCount > 0
              ? `deepest ${formatUsd(-wallet.maxNegativeBalanceUsd)} · on ${wallet.negativeDays} day${wallet.negativeDays === 1 ? "" : "s"}`
              : config.allowNegativeBalance
                ? "a buy that left the balance below zero"
                : `${wallet.notTakenCount.toLocaleString()} buy${wallet.notTakenCount === 1 ? "" : "s"} not taken for lack of balance`
          }
        />
        <StatTile label="Lowest balance" value={formatUsd(wallet.lowestBalanceUsd)} icon={TrendingDown} tone={wallet.lowestBalanceUsd < 0 ? "negative" : "default"} hint={reset ? "lowest point of any day" : "lowest point of the whole window"} />
        <StatTile label="Loss days" value={`${wallet.lossDays} / ${days.filter((d) => d.trades > 0).length}`} icon={CalendarDays} tone={wallet.lossDays > 0 ? "negative" : "default"} hint={`${wallet.profitDays} profit day${wallet.profitDays === 1 ? "" : "s"}`} />
        <StatTile label="Win rate" value={wallet.winRatePercent != null ? `${wallet.winRatePercent.toFixed(0)}%` : "—"} icon={Target} hint={`${wallet.wins}W / ${wallet.losses}L · ${wallet.closedPositionCount.toLocaleString()} closed trades`} />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{reset ? "Profit and loss of each day" : "Balance over time"}</h3>
        {!hasTrades ? (
          <div className="flex h-60 items-center justify-center px-4 text-center text-sm text-muted-foreground">No trades yet - the chart fills in as trades finish.</div>
        ) : reset ? (
          <DailyPnlChart days={days} />
        ) : (
          <BalanceChart data={data.curve} starting={config.startingBalanceUsd} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Day by day</h3>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead>Day (UTC)</TableHead>
                <TableHead className="text-right">Started at</TableHead>
                <TableHead className="text-right">Ended at</TableHead>
                <TableHead className="text-right">Lowest</TableHead>
                <TableHead className="text-right">P&amp;L</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="pr-4 text-right">Went negative</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((d) => (
                <TableRow key={d.date} className="border-border/60">
                  <TableCell className="whitespace-nowrap">
                    {new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} <span className="text-muted-foreground">{d.date.slice(5)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(d.startBalanceUsd)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", d.endBalanceUsd < 0 && "text-negative")}>{formatUsd(d.endBalanceUsd)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", d.lowestBalanceUsd < 0 && "text-negative")}>{formatUsd(d.lowestBalanceUsd)}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", pnlTone(d.pnlUsd))}>{d.trades > 0 ? formatUsd(d.pnlUsd) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.trades > 0 ? (
                      <>
                        {d.trades} <span className="text-xs text-muted-foreground">{d.wins}W/{d.losses}L</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className={cn("pr-4 text-right tabular-nums", d.negativeEvents > 0 && "text-negative")}>
                    {d.negativeEvents > 0 ? (
                      <>
                        {d.negativeEvents}× <span className="text-xs">to {formatUsd(-d.maxNegativeDepthUsd)}</span>
                      </>
                    ) : d.notTaken > 0 ? (
                      <span className="text-xs text-muted-foreground">{d.notTaken} not taken</span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className={cn("text-right tabular-nums", wallet.lowestBalanceUsd < 0 && "text-negative")}>{formatUsd(wallet.lowestBalanceUsd)}</TableCell>
                <TableCell className={cn("text-right font-medium tabular-nums", pnlTone(totals.pnlUsd))}>{formatUsd(totals.pnlUsd)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {totals.trades} <span className="text-xs text-muted-foreground">{totals.wins}W/{totals.losses}L</span>
                </TableCell>
                <TableCell className={cn("pr-4 text-right tabular-nums", totals.negativeEvents > 0 && "text-negative")}>{totals.negativeEvents > 0 ? `${totals.negativeEvents}×` : "—"}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
            {reset
              ? "Each day is its own wallet that starts from the starting balance; a trade counts for the day it was entered, even if it was sold after midnight. Open trades keep their cost out of that day's balance."
              : "A day's P&L is grouped by when the trades closed. The balance is cash: while a trade is open its cost is out of it, so it dips below the start even when nothing is lost."}
          </p>
        </div>
      </div>
    </div>
  );
}
