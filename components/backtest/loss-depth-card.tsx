"use client";

import { useMemo, useState } from "react";
import { TrendingDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd } from "@/lib/format";
import { countReaches, lossLevels } from "@/lib/loss-depth";
import type { BacktestLossDepth } from "@/lib/backtest-types";
import { formatDateTime } from "./shared";

const times = (n: number) => `${n.toLocaleString()} time${n === 1 ? "" : "s"}`;

/**
 * How much the balance can be down at one time: for every closed trade, how low it went if trading had started right there, and the lowest of
 * all of those (no day borders). Below it, how many starting trades went down at least a given level - a few round levels, or any you type.
 */
export function LossDepthCard({ depth }: { depth: BacktestLossDepth }) {
  const { lowest, depths, trades, belowZero, startingUsd } = depth;
  const deepest = lowest ? -lowest.pnlUsd : 0;
  const [draft, setDraft] = useState("");

  const ladder = useMemo(() => lossLevels(deepest).map((level) => ({ level, count: countReaches(depths, level) })), [deepest, depths]);
  const typed = Number(draft);
  const custom = draft.trim() !== "" && typed > 0 ? countReaches(depths, typed) : null;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingDown className="size-4 text-negative" /> Deepest loss
        </CardTitle>
        <CardDescription>
          How much the balance can be down at one time. For every closed trade it asks: if trading had started here, how low did the running total
          get afterwards? The deepest point is the lowest of all of those. Days don&apos;t matter, and only closed trades count (an open trade has no
          result yet).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <span className="text-[13px] font-semibold text-muted-foreground">Deepest point</span>
            {lowest ? (
              <>
                <span className="text-2xl font-extrabold tracking-tight text-negative tabular-nums">{formatUsd(lowest.pnlUsd)}</span>
                <span className="text-xs text-muted-foreground">
                  {startingUsd > 0 && <>{lowest.percent.toFixed(1)}% of the {formatUsd(startingUsd)} start · </>}
                  from trade {lowest.startTrade.toLocaleString()} ({formatDateTime(lowest.startAt)}) down to trade {lowest.troughTrade.toLocaleString()} (
                  {formatDateTime(lowest.troughAt)}) UTC
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-extrabold tracking-tight text-positive">Never below zero</span>
                <span className="text-xs text-muted-foreground">{trades > 0 ? "from no starting trade did the balance go down" : "no closed trades yet"}</span>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <span className="text-[13px] font-semibold text-muted-foreground">Starting trades that went below zero</span>
            <span className="text-2xl font-extrabold tracking-tight tabular-nums">
              {belowZero.toLocaleString()} <span className="text-base font-semibold text-muted-foreground">/ {trades.toLocaleString()}</span>
            </span>
            <span className="text-xs text-muted-foreground">of all closed trades, counting each as a place to have started</span>
          </div>
        </div>

        {lowest && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Times reached</h3>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead>Down at least</TableHead>
                    <TableHead className="text-right">Starting trades that reached it</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ladder.map((row) => (
                    <TableRow key={row.level} className="border-border/60">
                      <TableCell className="tabular-nums text-negative">{formatUsd(-row.level)}</TableCell>
                      <TableCell className="text-right tabular-nums">{times(row.count)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-border/60">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">-$</span>
                        <Input type="number" min={0} step="any" inputMode="decimal" placeholder="your level" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 w-28" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{custom !== null ? times(custom) : <span className="text-xs text-muted-foreground">type a level</span>}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              A starting trade counts when, from there on, the running total went down to the level at some point. Example: with trades +20, -5, +8, -7, +1, -15, +20, +20 the lowest points from trades 2 to 6
              are -18, -13, -21, -14 and -15, so a -$12 level is reached from 5 starting trades and the deepest point is -$21 (from trade 4).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
