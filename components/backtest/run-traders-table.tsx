"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAddress, formatUsd } from "@/lib/format";
import type { BacktestRunTraderView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { ProgressBar, StageBadge, formatSignedPercent, pnlTone, stageDescription } from "./shared";

type SortKey = "pnl" | "combined" | "winRate" | "trades" | "progress";
type Filter = "all" | "profitable" | "losing" | "running" | "failed";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "profitable", label: "Profitable" },
  { value: "losing", label: "Losing" },
  { value: "running", label: "In progress" },
  { value: "failed", label: "Failed" },
];

const sortValue: Record<SortKey, (t: BacktestRunTraderView) => number> = {
  pnl: (t) => t.stats.realizedPnlUsd,
  combined: (t) => t.stats.combinedPercent,
  winRate: (t) => t.stats.winRatePercent ?? -1,
  trades: (t) => t.stats.closed,
  progress: (t) => t.progressPercent,
};

function SortHead({
  label,
  k,
  sort,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {label}
        <Icon className="size-3" />
      </button>
    </TableHead>
  );
}

type Props = {
  traders: BacktestRunTraderView[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (address: string) => void;
};

/** Every address in the run with its own progress and the results it has produced so far. Click a row for the address's full page. */
export function RunTradersTable({ traders, selected, onSelectedChange, onOpen }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "pnl", dir: "desc" });

  const rows = useMemo(() => {
    const filtered = traders.filter((t) => {
      if (filter === "profitable") return t.stats.closed > 0 && t.stats.realizedPnlUsd > 0;
      if (filter === "losing") return t.stats.closed > 0 && t.stats.realizedPnlUsd < 0;
      if (filter === "running") return t.stage !== "done" && t.stage !== "failed";
      if (filter === "failed") return t.stage === "failed";
      return true;
    });
    const value = sortValue[sort.key];
    return [...filtered].sort((a, b) => (sort.dir === "desc" ? value(b) - value(a) : value(a) - value(b)));
  }, [traders, filter, sort]);

  const allSelected = rows.length > 0 && rows.every((t) => selected.has(t.address));

  function onSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  function toggleAll() {
    const next = new Set(selected);
    if (allSelected) rows.forEach((t) => next.delete(t.address));
    else rows.forEach((t) => next.add(t.address));
    onSelectedChange(next);
  }

  function toggleOne(address: string) {
    const next = new Set(selected);
    if (next.has(address)) next.delete(address);
    else next.add(address);
    onSelectedChange(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f.value} size="sm" variant={filter === f.value ? "default" : "outline"} onClick={() => setFilter(f.value)}>
            {f.label}
          </Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <input type="checkbox" aria-label="Select all" className="size-4 accent-primary" checked={allSelected} onChange={toggleAll} />
              </TableHead>
              <TableHead>Address &amp; progress</TableHead>
              <SortHead label="P&L" k="pnl" sort={sort} onSort={onSort} className="text-right" />
              <SortHead label="Combined" k="combined" sort={sort} onSort={onSort} className="hidden text-right md:table-cell" />
              <SortHead label="Win rate" k="winRate" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
              <SortHead label="Trades" k="trades" sort={sort} onSort={onSort} className="hidden pr-4 text-right sm:table-cell" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No address matches this filter.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const s = t.stats;
                const settled = t.stage === "done" || t.stage === "failed";
                return (
                  <TableRow
                    key={t.address}
                    className="cursor-pointer border-border/60"
                    data-state={selected.has(t.address) ? "selected" : undefined}
                    onClick={() => onOpen(t.address)}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.address}`}
                        className="size-4 accent-primary"
                        checked={selected.has(t.address)}
                        onChange={() => toggleOne(t.address)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex w-40 min-w-0 flex-col gap-1.5 sm:w-auto sm:max-w-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs font-medium" title={t.address}>
                            {t.label || formatAddress(t.address, 6)}
                          </span>
                          {settled && <StageBadge stage={t.stage} />}
                        </div>
                        {!settled && (
                          <>
                            <ProgressBar percent={t.progressPercent} />
                            <span className="truncate text-[11px] text-muted-foreground">
                              {t.progressPercent.toFixed(0)}% · {stageDescription(t)}
                            </span>
                          </>
                        )}
                        {t.stage === "failed" && t.error && <span className="line-clamp-2 text-[11px] break-words whitespace-normal text-negative">{t.error}</span>}
                        {t.stage === "done" && t.collect.signaturesFailed > 0 && (
                          <span className="text-[11px] break-words whitespace-normal text-amber-500">{t.collect.signaturesFailed} transaction(s) couldn&apos;t be fetched - results may be incomplete</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="flex flex-col gap-0.5">
                        <span className={cn("font-medium", pnlTone(s.realizedPnlUsd))}>{s.closed > 0 ? formatUsd(s.realizedPnlUsd) : "—"}</span>
                        <span className={cn("text-xs md:hidden", pnlTone(s.combinedPercent))}>{s.closed > 0 ? formatSignedPercent(s.combinedPercent, 0) : ""}</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn("hidden text-right tabular-nums md:table-cell", pnlTone(s.combinedPercent))}>
                      {s.closed > 0 ? formatSignedPercent(s.combinedPercent, 0) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="hidden pr-4 text-right tabular-nums sm:table-cell">
                      <div className="flex flex-col gap-0.5">
                        <span>{s.closed}</span>
                        {s.open > 0 && <span className="text-[11px] text-muted-foreground">+{s.open} open</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
