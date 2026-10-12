"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAddress, formatUsd } from "@/lib/format";
import type { BacktestRunTraderView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { ProgressBar, StageBadge, formatSignedPercent, pnlTone, stageDescription } from "./shared";

type SortKey = "pnl" | "combined" | "winRate" | "trades" | "lossDays" | "margin" | "withoutBest" | "progress";
type Filter = "all" | "profitable" | "losing" | "running" | "failed" | "skipped";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "profitable", label: "Profitable" },
  { value: "losing", label: "Losing" },
  { value: "running", label: "In progress" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped / stopped early" },
];

const NO_VALUE = -1e9; // sorts "no figure yet" below every real one

const sortValue: Record<SortKey, (t: BacktestRunTraderView) => number> = {
  pnl: (t) => t.stats.realizedPnlUsd,
  combined: (t) => t.stats.combinedPercent,
  winRate: (t) => t.stats.winRatePercent ?? -1,
  trades: (t) => t.stats.closed,
  lossDays: (t) => t.stats.daily?.lossDays ?? 0,
  margin: (t) => t.stats.daily?.profitMarginPercent ?? NO_VALUE,
  withoutBest: (t) => (t.stats.daily?.withoutBestDay ? t.stats.daily.withoutBestDay.combinedPercent : NO_VALUE),
  progress: (t) => t.progressPercent,
};

/**
 * Failed and skipped / stopped-early addresses belong ONLY under their own filter - never under Profitable or Losing, whatever
 * they made before they ended. An address still being worked on shows under In progress whether it is winning or losing right
 * now (and also under Profitable / Losing by its results so far).
 */
function matchesFilter(t: BacktestRunTraderView, filter: Filter): boolean {
  const failed = t.stage === "failed";
  const skipped = t.stage === "skipped";
  const running = !failed && !skipped && t.stage !== "done";
  if (filter === "failed") return failed;
  if (filter === "skipped") return skipped;
  if (filter === "running") return running;
  if (filter === "profitable") return !failed && !skipped && t.stats.closed > 0 && t.stats.realizedPnlUsd > 0;
  if (filter === "losing") return !failed && !skipped && t.stats.closed > 0 && t.stats.realizedPnlUsd < 0;
  return true;
}

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

/** Every address in the run with its own progress and the results it has produced so far. Click a row to open the address's full page in a new tab. */
export function RunTradersTable({ traders, selected, onSelectedChange, onOpen }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "pnl", dir: "desc" });
  const [limits, setLimits] = useState({ minWinRate: "", minMargin: "", maxLossDays: "", minTrades: "", holdsWithoutBest: false });

  const rows = useMemo(() => {
    const filtered = traders.filter((t) => matchesFilter(t, filter));
    const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
    const minWin = num(limits.minWinRate);
    const minMargin = num(limits.minMargin);
    const maxLoss = num(limits.maxLossDays);
    const minTrades = num(limits.minTrades);
    const limited = filtered.filter((t) => {
      const d = t.stats.daily;
      if (minWin != null && (t.stats.winRatePercent == null || t.stats.winRatePercent < minWin)) return false;
      if (minMargin != null && (d?.profitMarginPercent == null || d.profitMarginPercent < minMargin)) return false;
      if (maxLoss != null && (d?.lossDays ?? 0) > maxLoss) return false;
      if (minTrades != null && t.stats.closed < minTrades) return false;
      if (limits.holdsWithoutBest && !d?.withoutBestDay?.stillProfitable) return false;
      return true;
    });
    const value = sortValue[sort.key];
    return [...limited].sort((a, b) => (sort.dir === "desc" ? value(b) - value(a) : value(a) - value(b)));
  }, [traders, filter, sort, limits]);
  const limitsActive = limits.minWinRate !== "" || limits.minMargin !== "" || limits.maxLossDays !== "" || limits.minTrades !== "" || limits.holdsWithoutBest;

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
            {f.label} <span className="ml-1 text-xs opacity-70">{traders.filter((t) => matchesFilter(t, f.value)).length}</span>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        {(
          [
            ["minWinRate", "Win rate at least (%)"],
            ["minMargin", "Profit margin at least (%)"],
            ["maxLossDays", "Loss days at most"],
            ["minTrades", "Trades at least"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {label}
            <Input
              inputMode="decimal"
              value={limits[key]}
              onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value.replace(key === "minMargin" ? /[^0-9.-]/g : /[^0-9.]/g, "") }))}
              className="h-8 w-36"
            />
          </label>
        ))}
        <label className="flex items-center gap-2 pb-1.5 text-xs text-muted-foreground" title="Keep only traders that are still profitable after their single best day is removed">
          <input type="checkbox" className="size-4 accent-primary" checked={limits.holdsWithoutBest} onChange={(e) => setLimits((prev) => ({ ...prev, holdsWithoutBest: e.target.checked }))} />
          Still profitable without best day
        </label>
        {limitsActive && (
          <Button size="sm" variant="ghost" onClick={() => setLimits({ minWinRate: "", minMargin: "", maxLossDays: "", minTrades: "", holdsWithoutBest: false })}>
            Clear
          </Button>
        )}
        <span className="ml-auto pb-1.5 text-xs text-muted-foreground">
          {rows.length} of {traders.length} shown
        </span>
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
              <SortHead label="Loss days" k="lossDays" sort={sort} onSort={onSort} className="hidden text-right xl:table-cell" />
              <SortHead label="Profit margin" k="margin" sort={sort} onSort={onSort} className="hidden text-right xl:table-cell" />
              <SortHead label="Without best day" k="withoutBest" sort={sort} onSort={onSort} className="hidden text-right xl:table-cell" />
              <SortHead label="Trades" k="trades" sort={sort} onSort={onSort} className="hidden pr-4 text-right sm:table-cell" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  No address matches this filter.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const s = t.stats;
                const settled = t.stage === "done" || t.stage === "failed" || t.stage === "skipped";
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
                        {t.stage === "skipped" && t.error && <span className="line-clamp-2 text-[11px] break-words whitespace-normal text-amber-500">{t.error}</span>}
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
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">
                      {s.daily && s.daily.tradingDays > 0 ? (
                        <span className={s.daily.lossDays > 0 ? "text-negative" : undefined}>
                          {s.daily.lossDays}
                          <span className="text-xs text-muted-foreground"> / {s.daily.tradingDays}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className={cn("hidden text-right tabular-nums xl:table-cell", pnlTone(s.daily?.profitMarginPercent ?? 0))} title="How much of the profit is left after the losing days: (profit - loss) / profit">
                      {s.daily?.profitMarginPercent != null ? `${s.daily.profitMarginPercent.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">
                      {s.daily?.withoutBestDay ? (
                        <div className="flex flex-col gap-0.5" title={`Best day ${s.daily.bestDay?.date ?? ""} removed: ${formatUsd(s.daily.withoutBestDay.pnlUsd)}`}>
                          <span className={cn("font-medium", pnlTone(s.daily.withoutBestDay.combinedPercent))}>{formatSignedPercent(s.daily.withoutBestDay.combinedPercent, 0)}</span>
                          <span className={cn("text-[11px]", s.daily.withoutBestDay.stillProfitable ? "text-positive" : "text-negative")}>{s.daily.withoutBestDay.stillProfitable ? "still profit" : "turns loss"}</span>
                        </div>
                      ) : (
                        "—"
                      )}
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
