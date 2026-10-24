"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, Layers, Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { formatSignedPercent, pnlTone } from "./shared";

type SortKey = "created" | "pnl" | "safety" | "lowest";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "created", label: "Oldest first" },
  { key: "pnl", label: "Most profit" },
  { key: "safety", label: "Fewest capital-loss days" },
  { key: "lowest", label: "Highest lowest balance" },
];

/**
 * The combined views of one backtest: the same stored trades looked at as different wallets (other addresses, trade amount, fees, balance), side by side.
 * Creating a view costs nothing - no API or RPC call is made - so a backtest can be examined as many ways as wanted.
 */
export function ViewsTab({ runId, suggestedBalanceUsd, refreshKey = 0 }: { runId: string; suggestedBalanceUsd: number; refreshKey?: number }) {
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
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load the combined views"));
    return () => {
      cancelled = true;
    };
  }, [runId, refreshKey, reloadKey]);

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

  if (!data) return <Skeleton className="h-40 w-full" />;

  const views = [...data.views];
  if (sort === "pnl") views.sort((a, b) => b.summary.realizedPnlUsd - a.summary.realizedPnlUsd);
  else if (sort === "safety") views.sort((a, b) => a.summary.lostCapitalDays - b.summary.lostCapitalDays || b.summary.realizedPnlUsd - a.summary.realizedPnlUsd);
  else if (sort === "lowest") views.sort((a, b) => b.summary.lowestBalanceUsd - a.summary.lowestBalanceUsd);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Look at this backtest&apos;s stored trades as other wallets - a group of its addresses, a different trade amount, other fees, another starting balance - without simulating anything
          again. Each view is a separate combined wallet.
        </p>
        <div className="flex items-center gap-2">
          {views.length > 1 && (
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-52">
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
          )}
          {views.length > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setWalletsOpen(true)}>
              <Wallet className="size-4" /> Add to wallets
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setImportOpen(true)}>
            <Download className="size-4" /> Import from another backtest
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus className="size-4" /> New combined backtest
          </Button>
        </div>
      </div>

      {views.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 px-4 py-10 text-center">
          <Layers className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No combined views yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Create one (or paste several combinations at once, one per line) and pick the trade amount, fees and starting balance. The results appear straight away.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead>View</TableHead>
                <TableHead className="text-right">Addresses</TableHead>
                <TableHead>Priced with</TableHead>
                <TableHead className="text-right">Realized P&amp;L</TableHead>
                <TableHead className="text-right" title="Days on which starting the wallet would have run its balance out">
                  Capital-loss start days
                </TableHead>
                <TableHead className="text-right">Lowest balance</TableHead>
                <TableHead className="text-right" title="The deepest the profit and loss fell to over the whole window (realised results)">
                  Deepest loss
                </TableHead>
                <TableHead className="text-right" title="The total of the worst 7 days in a row (every 7 days in a row added up: 1-7, 2-8, 3-9 ...)">
                  Worst 7 days
                </TableHead>
                <TableHead className="text-right">Loss days</TableHead>
                <TableHead className="text-right">Win rate</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {views.map((v) => {
                const s = v.summary;
                return (
                  <TableRow key={v._id} className="border-border/60">
                    <TableCell className="max-w-56 font-medium">
                      <Link href={`/backtest/${runId}/views/${v._id}`} className="block truncate hover:underline">
                        {v.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.allAddresses ? "all" : v.addressCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatUsd(v.startingBalanceUsd)} start · {formatUsd(v.tradeSizeUsd)}/trade · {v.pumpFeePercent}% + {formatUsd(v.jitoFeeUsd)}
                      {v.resetDaily ? " · daily reset" : ""}
                    </TableCell>
                    <TableCell className={cn("text-right font-medium tabular-nums", pnlTone(s.realizedPnlUsd))}>
                      {formatUsd(s.realizedPnlUsd)} <span className="text-xs font-normal">{formatSignedPercent(s.returnPercent, 0)}</span>
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", s.lostCapitalDays > 0 ? "text-negative" : s.testedStartDays > 0 ? "text-positive" : undefined)}>
                      {s.testedStartDays > 0 ? `${s.lostCapitalDays} / ${s.testedStartDays}` : "—"}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", s.lowestBalanceUsd < 0 && "text-negative")}>{formatUsd(s.lowestBalanceUsd)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", (s.deepestLossUsd ?? 0) < 0 && "text-negative")}>{formatUsd(s.deepestLossUsd ?? 0)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", (s.worstStretchUsd ?? 0) < 0 && "text-negative")}>{s.worstStretchUsd != null ? formatUsd(s.worstStretchUsd) : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.lossDays} <span className="text-xs text-muted-foreground">/ {s.lossDays + s.profitDays}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}%` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.closedPositionCount.toLocaleString()}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-negative" aria-label={`Delete ${v.name}`} onClick={() => setRemoving({ _id: v._id, name: v.name })}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {walletsOpen && <AddViewsToWalletsDialog runId={runId} views={data.views} open onOpenChange={setWalletsOpen} />}

      {importOpen && <ImportViewsDialog runId={runId} open onOpenChange={setImportOpen} onImported={() => setReloadKey((k) => k + 1)} />}

      {newOpen && (
        <NewViewDialog
          runId={runId}
          source={data.source}
          suggestedBalanceUsd={suggestedBalanceUsd}
          open
          onOpenChange={setNewOpen}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{removing?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>Only this combined view is removed. The backtest and its trades are untouched, and you can make the view again at any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction className="bg-negative text-negative-foreground hover:bg-negative/90" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
