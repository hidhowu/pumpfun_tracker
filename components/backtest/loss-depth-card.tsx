"use client";

import { useMemo, useState } from "react";
import { CalendarX, TrendingDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd } from "@/lib/format";
import { countReaches, lossLevels } from "@/lib/loss-depth";
import type { BacktestLossDepth } from "@/lib/backtest-types";
import { formatDateTime } from "./shared";

const MAX_TIMES_SHOWN = 6;
const times = (n: number) => `${n.toLocaleString()} time${n === 1 ? "" : "s"}`;

/**
 * The deepest the profit and loss fell while trading, which the daily totals hide (a day that ends at +$20 may have been at -$80 on the way).
 * The headline is the lowest point of the whole time frame, with no boundaries: if it fell to -$120, climbed back, and later fell to -$121,
 * the deepest point is -$121. Below it: the worst single day, and how many times the P&L dropped to a level (a few round levels, or any you type).
 */
export function LossDepthCard({ depth }: { depth: BacktestLossDepth }) {
  const { lowest, deepestDay, swings, resetDaily, startingUsd } = depth;
  const deepest = lowest ? -lowest.pnlUsd : 0;
  const [draft, setDraft] = useState("");

  const ladder = useMemo(() => lossLevels(deepest).map((level) => ({ level, ...countReaches(swings, level) })), [deepest, swings]);
  const typed = Number(draft);
  const custom = useMemo(() => (draft.trim() !== "" && typed > 0 ? countReaches(swings, typed) : null), [draft, typed, swings]);

  const pct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingDown className="size-4 text-negative" /> Deepest loss
        </CardTitle>
        <CardDescription>
          The lowest the profit and loss fell to, counting closed trades in the order they closed
          {resetDaily ? " (the balance resets every day, so each day starts again from zero and this is the worst day)" : " (no day boundaries: a new, deeper low replaces the old one)"}. Open trades have no result yet, so they are not
          counted.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <span className="text-[13px] font-semibold text-muted-foreground">{resetDaily ? "Deepest loss (worst day)" : "Deepest loss reached"}</span>
            {lowest ? (
              <>
                <span className="text-2xl font-extrabold tracking-tight text-negative tabular-nums">{formatUsd(lowest.pnlUsd)}</span>
                <span className="text-xs text-muted-foreground">
                  {startingUsd > 0 && <>{pct(lowest.percent)} of the {formatUsd(startingUsd)} start · </>}
                  {lowest.at != null ? `${formatDateTime(lowest.at)} UTC` : ""}
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-extrabold tracking-tight text-positive">Never below zero</span>
                <span className="text-xs text-muted-foreground">the profit and loss never fell under where it started</span>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
              <CalendarX className="size-3.5" /> Worst single day
            </span>
            {deepestDay ? (
              <>
                <span className="text-2xl font-extrabold tracking-tight text-negative tabular-nums">{formatUsd(deepestDay.pnlUsd)}</span>
                <span className="text-xs text-muted-foreground">
                  {deepestDay.date} UTC{startingUsd > 0 && <> · {pct(deepestDay.percent)} of the start</>} · every day starts at zero
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl font-extrabold tracking-tight text-positive">No losing dip</span>
                <span className="text-xs text-muted-foreground">no day went below its starting point</span>
              </>
            )}
          </div>
        </div>

        {lowest && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">How many times it dropped this far</h3>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead>Loss of at least</TableHead>
                    <TableHead className="text-right">Times reached</TableHead>
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
                    <TableCell className="text-right tabular-nums">{custom ? times(custom.count) : <span className="text-xs text-muted-foreground">type a level</span>}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {custom && custom.count > 0 && (
              <p className="text-xs text-muted-foreground">
                Reached on {custom.at.slice(0, MAX_TIMES_SHOWN).map((t) => formatDateTime(t)).join(" · ")} UTC
                {custom.at.length > MAX_TIMES_SHOWN ? ` · and ${custom.at.length - MAX_TIMES_SHOWN} more` : ""}.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              A visit counts when the profit and loss drops down to the level; it counts again only after it has climbed back above the level and dropped to it once more.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
