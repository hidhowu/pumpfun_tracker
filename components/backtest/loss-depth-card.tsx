"use client";

import { useMemo, useState } from "react";
import { TrendingDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd } from "@/lib/format";
import { countReaches, lossLevels } from "@/lib/loss-depth";
import type { BacktestLossDepth } from "@/lib/backtest-types";
import { Mini, Note, Panel } from "./parts";
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
    <Panel
      title="Deepest loss"
      icon={<TrendingDown className="size-4 text-negative" />}
      help="How much the balance can be down at one time. For every closed trade it asks: if trading had started here, how low did the running total get afterwards? The deepest point is the lowest of all of those. Days don't matter, and only closed trades count (an open trade has no result yet). A starting trade counts when, from there on, the running total went down to the level at some point."
      aside="how low the balance can be down at once"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {lowest ? (
          <Mini
            label="Deepest point"
            value={formatUsd(lowest.pnlUsd)}
            tone="neg"
            hint={
              <>
                {startingUsd > 0 && <>{lowest.percent.toFixed(1)}% of the {formatUsd(startingUsd)} start · </>}
                trade {lowest.startTrade.toLocaleString()} → trade {lowest.troughTrade.toLocaleString()} ({formatDateTime(lowest.startAt)} → {formatDateTime(lowest.troughAt)} UTC)
              </>
            }
          />
        ) : (
          <Mini label="Deepest point" value="Never below zero" tone="pos" hint={trades > 0 ? "from no starting trade did the balance go down" : "no closed trades yet"} />
        )}
        <Mini
          label="Starting trades that went below zero"
          value={
            <>
              {belowZero.toLocaleString()} <span className="text-base font-medium text-text-3">/ {trades.toLocaleString()}</span>
            </>
          }
          hint="of all closed trades, counting each as a place to have started"
        />
      </div>

      {lowest && (
        <div className="flex flex-col gap-2.5">
          <b className="text-[13px] font-semibold">Times reached</b>
          {/* Wide screens: a table. */}
          <div className="overflow-hidden rounded-xl border border-border max-md:hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Down at least</TableHead>
                  <TableHead className="text-right text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Starting trades that reached it</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ladder.map((row) => (
                  <TableRow key={row.level} className="border-border">
                    <TableCell className="text-[13px] text-negative tabular-nums">{formatUsd(-row.level)}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{times(row.count)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-border">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="text-text-3">−$</span>
                      <Input type="number" min={0} step="any" inputMode="decimal" placeholder="your level" aria-label="Your own loss level" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 w-28" />
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{custom !== null ? times(custom) : <span className="text-xs text-text-3">type a level</span>}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {/* Phone: the levels as little pills, then the level you can type. */}
          <div className="flex flex-wrap gap-1.5 md:hidden">
            {ladder.map((row) => (
              <span key={row.level} className="inline-flex h-[26px] items-center rounded-full border border-destructive/30 bg-neg-soft px-2.5 text-xs text-destructive tabular-nums">
                {formatUsd(-row.level)} · {row.count.toLocaleString()}×
              </span>
            ))}
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm md:hidden">
            <span className="text-text-3">Custom level −$</span>
            <Input type="number" min={0} step="any" inputMode="decimal" placeholder="150" aria-label="Your own loss level" value={draft} onChange={(e) => setDraft(e.target.value)} className="h-10 w-24" />
            <span className="text-text-2 tabular-nums">{custom !== null ? `→ ${custom.toLocaleString()}×` : ""}</span>
          </label>
          <Note className="max-md:hidden">Example: with trades +20, −5, +8, −7, +1, −15, +20, +20 the lowest points from trades 2 to 6 are −18, −13, −21, −14 and −15, so a −$12 level is reached from 5 starting trades and the deepest point is −$21.</Note>
        </div>
      )}
    </Panel>
  );
}
