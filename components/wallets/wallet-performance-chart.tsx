"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatUsd } from "@/lib/format";
import type { WalletDailyPnl } from "@/lib/types";

type Props = { dailyBreakdown: WalletDailyPnl[] };

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: WalletDailyPnl }> }) {
  if (!active || !payload?.length) return null;
  const day = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{day.date}</div>
      <div className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
        <span>Value: <span className="text-foreground">{day.valueUsd !== null ? formatUsd(day.valueUsd) : "—"}</span></span>
        {day.closedTradeCount > 0 && (
          <span>
            {day.closedTradeCount} trade{day.closedTradeCount === 1 ? "" : "s"} ·{" "}
            <span className={day.combinedUsd >= 0 ? "text-positive" : "text-negative"}>{formatUsd(day.combinedUsd)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** A wallet's value over time (day/week/month), from its daily snapshots - the app's first chart, built with recharts. */
export function WalletPerformanceChart({ dailyBreakdown }: Props) {
  const points = dailyBreakdown.filter((d) => d.valueUsd !== null);
  if (points.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        Not enough history yet to chart - check back after a day or two.
      </div>
    );
  }

  const first = points[0].valueUsd ?? 0;
  const last = points[points.length - 1].valueUsd ?? 0;
  const isUp = last >= first;
  const color = isUp ? "var(--positive)" : "var(--negative)";

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="walletValueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(5)}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => formatUsd(v)}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="valueUsd" stroke={color} strokeWidth={2} fill="url(#walletValueGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
