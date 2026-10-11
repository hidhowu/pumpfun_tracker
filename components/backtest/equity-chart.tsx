"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { getBacktestEquity } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestEquityPoint } from "@/lib/backtest-types";
import { formatDateTime } from "./shared";

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

type Datum = { t: number; cumulativeUsd: number; n: number };

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Datum }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-foreground">{formatDateTime(p.t)} UTC</div>
      <div className="mt-1 text-muted-foreground">
        Cumulative P&amp;L:{" "}
        <span className={p.cumulativeUsd > 0 ? "text-positive" : p.cumulativeUsd < 0 ? "text-negative" : "text-foreground"}>{formatUsd(p.cumulativeUsd)}</span>
      </div>
      <div className="text-muted-foreground">After {p.n} closed trade{p.n === 1 ? "" : "s"}</div>
    </div>
  );
}

/** Cumulative realized P&L of the closed trades so far - for the whole run, or one address. Refetches whenever `refreshKey` changes. */
export function EquityChart({ runId, address, refreshKey = 0 }: { runId: string; address?: string; refreshKey?: number }) {
  const [points, setPoints] = useState<BacktestEquityPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBacktestEquity(runId, address)
      .then((res) => !cancelled && setPoints(res.points))
      .catch(() => !cancelled && setPoints((prev) => prev ?? []));
    return () => {
      cancelled = true;
    };
  }, [runId, address, refreshKey]);

  const data: Datum[] = useMemo(() => (points ?? []).map((p) => ({ t: new Date(p.t).getTime(), cumulativeUsd: p.cumulativeUsd, n: p.n })), [points]);

  if (points === null) return <Skeleton className="h-56 w-full" />;
  if (data.length === 0) {
    return <div className="flex h-56 items-center justify-center px-4 text-center text-sm text-muted-foreground">No closed trades yet - the chart fills in as trades finish.</div>;
  }

  const up = data[data.length - 1].cumulativeUsd >= 0;
  const color = up ? "var(--positive)" : "var(--negative)";
  const gradientId = `bt-equity-${address ?? "all"}`.replace(/[^a-zA-Z0-9-]/g, "");

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" })}
            tick={axisTick}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => formatUsd(v)} tick={axisTick} axisLine={false} tickLine={false} width={64} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip content={<ChartTooltip />} />
          <Area type="stepAfter" dataKey="cumulativeUsd" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={data.length <= 3 ? { r: 3, fill: color } : false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
