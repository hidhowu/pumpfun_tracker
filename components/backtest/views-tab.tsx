"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, EllipsisVertical, Layers, Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteBacktestView, listBacktestViews } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestViewList } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { AddViewsToWalletsDialog } from "./add-views-to-wallets-dialog";
import { ImportViewsDialog } from "./import-views-dialog";
import { NewViewDialog } from "./new-view-dialog";
import { EmptyNote, Kpi } from "./parts";
import { formatSignedPercent, pnlTone } from "./shared";

type SortKey = "created" | "pnl" | "safety" | "lowest";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "created", label: "Oldest first" },
  { key: "pnl", label: "Most profit" },
  { key: "safety", label: "Fewest capital-loss days" },
  { key: "lowest", label: "Highest lowest balance" },
];

const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

/**
 * The combined views of one backtest: the same stored trades looked at as different wallets (other addresses, trade amount, fees, balance), side by side.
 * Creating a view costs nothing - no API or RPC call is made - so a backtest can be examined as many ways as wanted.
 */
export function ViewsTab({ runId, suggestedBalanceUsd, refreshKey = 0, onCount }: { runId: string; suggestedBalanceUsd: number; refreshKey?: number; /** Tells the page how many views there are (for the tab badge). */ onCount?: (count: number) => void }) {
  const [data, setData] = useState<BacktestViewList | null>(null);
  const [sort, setSort] = useState<SortKey>("created");
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);
  const [removing, setRemoving] = useState<{ _id: string; name: string } | null>(null);

  // Bumped after a change made here (a view created or deleted) so the list is read again.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listBacktestViews(runId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        onCount?.(res.views.length);
      })
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load the combined views"));
    return () => {
      cancelled = true;
    };
  }, [runId, refreshKey, reloadKey, onCount]);

  async function remove() {
    if (!removing) return;
    try {
      await deleteBacktestView(runId, removing._id);
      toast.success(`Deleted "${removing.name}"`);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setRemoving(null);
    }
  }

  if (!data) return <Skeleton className="h-40 w-full rounded-[20px]" />;

  const views = [...data.views];
  if (sort === "pnl") views.sort((a, b) => b.summary.realizedPnlUsd - a.summary.realizedPnlUsd);
  else if (sort === "safety") views.sort((a, b) => a.summary.lostCapitalDays - b.summary.lostCapitalDays || b.summary.realizedPnlUsd - a.summary.realizedPnlUsd);
  else if (sort === "lowest") views.sort((a, b) => b.summary.lowestBalanceUsd - a.summary.lowestBalanceUsd);

  const sortSelect =
    views.length > 1 ? (
      <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
        <SelectTrigger size="sm" className="w-52 max-md:h-11 max-md:w-full" aria-label="Sort the views">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((s) => (
            <SelectItem key={s.key} value={s.key}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Wide screens: sort and the three actions in one row. */}
      <div className="flex flex-wrap items-center gap-2 max-md:hidden">
        {sortSelect}
        {views.length > 0 && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setWalletsOpen(true)}>
            <Wallet /> Add to wallets
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
          <Download /> Import from another backtest
        </Button>
        <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
          <Plus /> New combined backtest
        </Button>
      </div>
      {/* Phone: the main action first, then the rest. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        <Button size="lg" className="w-full gap-1.5" onClick={() => setNewOpen(true)}>
          <Plus className="size-4" /> New combined backtest
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="outline" className="h-11 gap-1.5" onClick={() => setImportOpen(true)}>
            <Download /> Import
          </Button>
          <Button variant="outline" className="h-11 gap-1.5" disabled={views.length === 0} onClick={() => setWalletsOpen(true)}>
            <Wallet /> Add to wallets
          </Button>
        </div>
        {sortSelect}
      </div>

      {views.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-line-3 bg-card/50">
          <EmptyNote icon={<Layers className="size-5" />}>
            <b className="block text-[15px] font-semibold text-foreground">No combined views yet</b>
            <span className="mt-1 block text-[13px]">Create one (or paste several combinations at once, one per line) and pick the trade amount, fees and starting balance. The results appear straight away.</span>
          </EmptyNote>
        </div>
      ) : (
        <>
          {/* Phone: one card per view. */}
          <div className="flex flex-col gap-3 md:hidden">
            {views.map((v) => {
              const s = v.summary;
              return (
                <article key={v._id} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                  <div className="flex items-start gap-2">
                    <Link href={`/backtest/${runId}/views/${v._id}`} className="flex min-w-0 flex-1 flex-col gap-1">
                      <b className="truncate text-[15px] font-semibold">{v.name}</b>
                      <span className="text-xs text-text-3">{v.allAddresses ? "All addresses" : `${v.addressCount} addresses`}</span>
                      <span className="text-xs text-text-3">
                        {formatUsd(v.startingBalanceUsd)} start · {formatUsd(v.tradeSizeUsd)}/trade · {v.pumpFeePercent}% + {formatUsd(v.jitoFeeUsd)}
                        {v.resetDaily ? " · daily reset" : ""}
                      </span>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon-lg" aria-label={`More actions for ${v.name}`}>
                          <EllipsisVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem variant="destructive" className="min-h-10 gap-2.5" onSelect={() => setRemoving({ _id: v._id, name: v.name })}>
                          <Trash2 className="size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3">
                    <Kpi label="Realized P&L" value={formatUsd(s.realizedPnlUsd)} className={pnlTone(s.realizedPnlUsd)} />
                    <Kpi label="Capital-loss days" value={s.testedStartDays > 0 ? `${s.lostCapitalDays} / ${s.testedStartDays}` : "—"} className={s.lostCapitalDays > 0 ? "text-negative" : s.testedStartDays > 0 ? "text-positive" : undefined} />
                    <Kpi label="Lowest balance" value={formatUsd(s.lowestBalanceUsd)} className={s.lowestBalanceUsd < 0 ? "text-negative" : undefined} />
                    <Kpi label="Deepest loss" value={formatUsd(s.deepestLossUsd ?? 0)} className={(s.deepestLossUsd ?? 0) < 0 ? "text-negative" : undefined} />
                    <Kpi label="Worst 7 days" value={s.worstStretchUsd != null ? formatUsd(s.worstStretchUsd) : "—"} className={(s.worstStretchUsd ?? 0) < 0 ? "text-negative" : undefined} />
                    <Kpi label="Win rate" value={s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"} />
                  </div>
                </article>
              );
            })}
          </div>

          {/* Wide screens: the table scrolls sideways inside its box. */}
          <div className="overflow-hidden rounded-[20px] border border-border bg-card max-md:hidden">
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={cn(headCls, "pl-5")}>View</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Addresses</TableHead>
                  <TableHead className={headCls}>Priced with</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Realized P&amp;L</TableHead>
                  <TableHead className={cn(headCls, "text-right")} title="Days on which starting the wallet would have run its balance out">
                    Capital-loss start days
                  </TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Lowest balance</TableHead>
                  <TableHead className={cn(headCls, "text-right")} title="The deepest the profit and loss fell to over the whole window (realised results)">
                    Deepest loss
                  </TableHead>
                  <TableHead className={cn(headCls, "text-right")} title="The total of the worst 7 days in a row (every 7 days in a row added up: 1-7, 2-8, 3-9 ...)">
                    Worst 7 days
                  </TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Loss days</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Win rate</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Trades</TableHead>
                  <TableHead className="w-12 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {views.map((v) => {
                  const s = v.summary;
                  return (
                    <TableRow key={v._id} className="h-[60px] border-border">
                      <TableCell className="max-w-56 pl-5 text-[13px] font-semibold">
                        <Link href={`/backtest/${runId}/views/${v._id}`} className="block truncate hover:text-primary">
                          {v.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{v.allAddresses ? "all" : v.addressCount}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-text-2">
                        {formatUsd(v.startingBalanceUsd)} start · {formatUsd(v.tradeSizeUsd)}/trade · {v.pumpFeePercent}% + {formatUsd(v.jitoFeeUsd)}
                        {v.resetDaily ? " · daily reset" : ""}
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <span className="inline-flex flex-col items-end leading-[1.3]">
                          <b className={cn("font-semibold", pnlTone(s.realizedPnlUsd))}>{formatUsd(s.realizedPnlUsd)}</b>
                          <span className={cn("text-xs", pnlTone(s.returnPercent))}>{formatSignedPercent(s.returnPercent, 0)}</span>
                        </span>
                      </TableCell>
                      <TableCell className={cn("text-right text-[13px] tabular-nums", s.lostCapitalDays > 0 ? "text-negative" : s.testedStartDays > 0 ? "text-positive" : undefined)}>
                        {s.testedStartDays > 0 ? `${s.lostCapitalDays} / ${s.testedStartDays}` : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-[13px] tabular-nums", s.lowestBalanceUsd < 0 && "text-negative")}>{formatUsd(s.lowestBalanceUsd)}</TableCell>
                      <TableCell className={cn("text-right text-[13px] tabular-nums", (s.deepestLossUsd ?? 0) < 0 && "text-negative")}>{formatUsd(s.deepestLossUsd ?? 0)}</TableCell>
                      <TableCell className={cn("text-right text-[13px] tabular-nums", (s.worstStretchUsd ?? 0) < 0 && "text-negative")}>{s.worstStretchUsd != null ? formatUsd(s.worstStretchUsd) : "—"}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        {s.lossDays} <span className="text-xs text-text-3">/ {s.lossDays + s.profitDays}</span>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{s.closedPositionCount.toLocaleString()}</TableCell>
                      <TableCell className="pr-4">
                        <Button variant="ghost" size="icon-sm" className="text-text-3 hover:text-negative" aria-label={`Delete ${v.name}`} onClick={() => setRemoving({ _id: v._id, name: v.name })}>
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {walletsOpen && <AddViewsToWalletsDialog runId={runId} views={data.views} open onOpenChange={setWalletsOpen} />}

      {importOpen && <ImportViewsDialog runId={runId} open onOpenChange={setImportOpen} onImported={() => setReloadKey((k) => k + 1)} />}

      {newOpen && (
        <NewViewDialog runId={runId} source={data.source} suggestedBalanceUsd={suggestedBalanceUsd} open onOpenChange={setNewOpen} onSaved={() => setReloadKey((k) => k + 1)} />
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{removing?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Only this view is removed. The backtest and its trades stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
