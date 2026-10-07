"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd } from "@/lib/format";
import type { WalletPnlBreakdown } from "@/lib/types";

export type ChartMode = "value" | "pnl";

/** One x-axis slot of the chart - an hour (Day view) or a day (Week/Month view) - in the shape both chart modes read. */
export type ChartPoint = {
  key: string;
  tick: string;
  title: string;
  value: number | null; // wallet value; null = nothing to plot (future hour, no baseline yet)
  valueEstimated: boolean;
  pnl: number; // realized P&L of trades that closed in this slot
  gain: number; // pnl split in two so each sign gets its own bar color
  loss: number;
  trades: number;
  wins: number;
  losses: number;
};

const nextHour = (hour: number) => String((hour + 1) % 24).padStart(2, "0") + ":00";

/** Day period -> 24 hourly points; week/month -> one point per day. */
export function toChartPoints(pnl: WalletPnlBreakdown): ChartPoint[] {
  if (pnl.hourlyBreakdown) {
    return pnl.hourlyBreakdown.map((h) => ({
      key: `h${h.hour}`,
      tick: h.label,
      title: `${h.label} – ${nextHour(h.hour)} UTC`,
      value: h.valueUsd,
      valueEstimated: h.valueEstimated,
      pnl: h.pnlUsd,
      gain: h.pnlUsd > 0 ? h.pnlUsd : 0,
      loss: h.pnlUsd < 0 ? h.pnlUsd : 0,
      trades: h.tradeCount,
      wins: h.wins,
      losses: h.losses,
    }));
  }
  return pnl.dailyBreakdown.map((d) => ({
    key: d.date,
    tick: d.date.slice(5),
    title: `${new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}, ${d.date}`,
    value: d.valueUsd,
    valueEstimated: false,
    pnl: d.combinedUsd,
    gain: d.combinedUsd > 0 ? d.combinedUsd : 0,
    loss: d.combinedUsd < 0 ? d.combinedUsd : 0,
    trades: d.closedTradeCount,
    wins: d.wins,
    losses: d.losses,
  }));
}

function ChartTooltip({ active, payload, mode }: { active?: boolean; payload?: Array<{ payload: ChartPoint }>; mode: ChartMode }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{p.title}</div>
      <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
        {mode === "value" ? (
          <span>
            Value: <span className="text-foreground">{p.value !== null ? formatUsd(p.value) : "—"}</span>
            {p.valueEstimated && <span className="ml-1 opacity-70">(estimated)</span>}
          </span>
        ) : (
          <span>
            P&amp;L: <span className={p.pnl > 0 ? "text-positive" : p.pnl < 0 ? "text-negative" : "text-foreground"}>{formatUsd(p.pnl)}</span>
          </span>
        )}
        {p.trades > 0 ? (
          <span>
            {p.trades} closed trade{p.trades === 1 ? "" : "s"} · {p.wins}W / {p.losses}L
            {mode === "value" && (
              <>
                {" · "}
                <span className={p.pnl >= 0 ? "text-positive" : "text-negative"}>{formatUsd(p.pnl)}</span>
              </>
            )}
          </span>
        ) : (
          <span>No closed trades</span>
        )}
      </div>
    </div>
  );
}

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };
const margin = { top: 8, right: 8, left: 0, bottom: 0 };

/**
 * A wallet's performance over time - either its total value (area) or its
 * realized P&L (bars) - per hour for the Day view, per day for Week/Month.
 * Built with recharts.
 */
export function WalletPerformanceChart({ points, mode }: { points: ChartPoint[]; mode: ChartMode }) {
  // 24 hourly slots: label every 3rd hour starting at 00:00 rather than letting recharts pick an arbitrary offset.
  const tickInterval = points.length === 24 ? 2 : "preserveEnd";
  if (mode === "pnl") {
    if (!points.some((p) => p.trades > 0)) {
      return <EmptyState>No closed trades in this period yet.</EmptyState>;
    }
    return (
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={margin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="tick" tick={axisTick} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={12} interval={tickInterval} />
            <YAxis tickFormatter={(v: number) => formatUsd(v)} tick={axisTick} axisLine={false} tickLine={false} width={64} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Tooltip content={<ChartTooltip mode="pnl" />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
            <Bar dataKey="gain" stackId="pnl" fill="var(--positive)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="loss" stackId="pnl" fill="var(--negative)" radius={[0, 0, 3, 3]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const plotted = points.filter((p) => p.value !== null);
  if (plotted.length === 0) {
    return <EmptyState>No wallet value history for this period yet - it fills in as the tracker records snapshots.</EmptyState>;
  }

  const isUp = (plotted[plotted.length - 1].value ?? 0) >= (plotted[0].value ?? 0);
  const color = isUp ? "var(--positive)" : "var(--negative)";

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={margin}>
          <defs>
            <linearGradient id="walletValueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="tick" tick={axisTick} axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={12} interval={tickInterval} />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => formatUsd(v)}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip content={<ChartTooltip mode="value" />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill="url(#walletValueGradient)"
            connectNulls={false}
            dot={plotted.length <= 3 ? { r: 3, fill: color } : false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="flex h-56 items-center justify-center px-4 text-center text-sm text-muted-foreground">{children}</div>;
}
