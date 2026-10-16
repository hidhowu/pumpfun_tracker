"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Copy, Info, Layers, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { deleteBacktestView } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestViewWallet } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { CombinedWalletPanel } from "./combined-wallet-panel";
import { NewViewDialog } from "./new-view-dialog";
import { pnlTone } from "./shared";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

/** One combined view of a backtest: the shared wallet (same panel as a combined backtest) plus how much each address contributed. */
export function ViewDashboard({ runId, viewId }: { runId: string; viewId: string }) {
  const router = useRouter();
  const [wallet, setWallet] = useState<BacktestViewWallet | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function remove() {
    try {
      await deleteBacktestView(runId, viewId);
      toast.success("Combined view deleted");
      router.push(`/backtest/${runId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
      setDeleteOpen(false);
    }
  }

  const view = wallet?.view;
  const src = wallet?.source;
  const totalPnl = wallet?.perAddress.reduce((n, a) => n + a.pnlUsd, 0) ?? 0;
  const copyAll = () => {
    if (!wallet) return;
    navigator.clipboard
      .writeText(wallet.perAddress.map((a) => a.address).join("\n"))
      .then(() => toast.success("Addresses copied"))
      .catch(() => toast.error("Could not copy"));
  };

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
        <Link href={`/backtest/${runId}`}>
          <ArrowLeft className="size-4" /> Back to the backtest
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{view?.name ?? "Combined view"}</h1>
            <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/10 font-normal text-primary">
              <Layers className="size-3" /> Combined view
            </Badge>
          </div>
          {view && src && (
            <p className="text-sm text-muted-foreground">
              {view.allAddresses ? "Every address of the backtest" : `${view.addressCount} address${view.addressCount === 1 ? "" : "es"}`} · priced at {formatUsd(view.tradeSizeUsd)} per trade, {view.pumpFeePercent}% +{" "}
              {formatUsd(view.jitoFeeUsd)} fees
              {src.tradeSizeUsd != null && (
                <>
                  {" "}
                  (the backtest used {formatUsd(src.tradeSizeUsd)}, {src.pumpFeePercent ?? 0}% + {formatUsd(src.jitoFeeUsd ?? 0)})
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={!wallet} onClick={() => setEditOpen(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground hover:text-negative" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </div>

      {wallet && wallet.warnings.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs">
          {wallet.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2 text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      <CombinedWalletPanel runId={runId} viewId={viewId} refreshKey={refreshKey} onLoaded={setWallet} />

      {wallet && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Addresses in this view</h3>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={copyAll}>
              <Copy className="size-3.5" /> Copy addresses
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Closed trades</TableHead>
                  <TableHead className="text-right">Win / loss</TableHead>
                  <TableHead className="text-right">Fees paid</TableHead>
                  <TableHead className="text-right">P&amp;L</TableHead>
                  <TableHead className="pr-4 text-right">Share of P&amp;L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallet.perAddress.map((a) => (
                  <TableRow key={a.address} className="border-border/60">
                    <TableCell className="font-mono text-xs">
                      <Link href={`/backtest/${runId}/${a.address}`} className="hover:underline" title={a.address}>
                        {short(a.address)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.trades.toLocaleString()}
                      {a.open > 0 && <span className="text-xs text-muted-foreground"> +{a.open} open</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.wins}W / {a.losses}L
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatUsd(a.feesUsd)}</TableCell>
                    <TableCell className={cn("text-right font-medium tabular-nums", pnlTone(a.pnlUsd))}>{a.trades + a.open > 0 ? formatUsd(a.pnlUsd) : "—"}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">{totalPnl > 0 && a.pnlUsd > 0 ? `${((a.pnlUsd / totalPnl) * 100).toFixed(0)}%` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{wallet.perAddress.reduce((n, a) => n + a.trades, 0).toLocaleString()}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{formatUsd(wallet.feesUsd)}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", pnlTone(totalPnl))}>{formatUsd(totalPnl)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Worked out from the trades the backtest already simulated (it is {wallet.sourceStatus}), so nothing was fetched again. Each trade keeps its entry, exit and price move from the backtest;
              its amount and fees are this view&apos;s. A view always follows its backtest: when more addresses finish or are added, reopen it to see the new totals.
            </span>
          </p>
        </div>
      )}

      {editOpen && view && src && (
        <NewViewDialog
          runId={runId}
          source={src}
          suggestedBalanceUsd={view.startingBalanceUsd}
          editing={view}
          open
          onOpenChange={setEditOpen}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this combined view?</AlertDialogTitle>
            <AlertDialogDescription>Only this view is removed. The backtest and its trades are untouched, and you can make the view again at any time.</AlertDialogDescription>
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
