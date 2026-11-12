"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, Copy, Pencil, Trash2, TriangleAlert, Wallet } from "lucide-react";
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
import { copyText } from "@/lib/clipboard";
import { formatUsd } from "@/lib/format";
import type { BacktestViewWallet } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { AddViewsToWalletsDialog } from "./add-views-to-wallets-dialog";
import { CombinedWalletPanel } from "./combined-wallet-panel";
import { NewViewDialog } from "./new-view-dialog";
import { Note } from "./parts";
import { Pill, pnlTone } from "./shared";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;
const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

/** One combined view of a backtest: the shared wallet (same panel as a combined backtest) plus how much each address contributed. */
export function ViewDashboard({ runId, viewId }: { runId: string; viewId: string }) {
  const router = useRouter();
  const [wallet, setWallet] = useState<BacktestViewWallet | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [walletsOpen, setWalletsOpen] = useState(false);

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
  async function copyAll() {
    if (!wallet) return;
    if (await copyText(wallet.perAddress.map((a) => a.address).join("\n"))) toast.success("Addresses copied");
    else toast.error("Could not copy");
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <Link href={`/backtest/${runId}`} className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Back to the backtest
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px]">{view?.name ?? "Combined view"}</h1>
            <Pill tone="volt">Combined view</Pill>
          </div>
          {view && src && (
            <span className="text-[13px] text-text-2">
              {view.allAddresses ? "Every address of the backtest" : `${view.addressCount} address${view.addressCount === 1 ? "" : "es"}`} · priced at {formatUsd(view.tradeSizeUsd)} per trade, {view.pumpFeePercent}% +{" "}
              {formatUsd(view.jitoFeeUsd)} fees
              {src.tradeSizeUsd != null && (
                <>
                  {" "}
                  (the backtest used {formatUsd(src.tradeSizeUsd)}, {src.pumpFeePercent ?? 0}% + {formatUsd(src.jitoFeeUsd ?? 0)})
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="gap-1.5 max-md:h-11" disabled={!wallet} onClick={() => setEditOpen(true)}>
            <Pencil /> Edit
          </Button>
          <Button variant="outline" className="gap-1.5 max-md:h-11" onClick={() => setDeleteOpen(true)}>
            <Trash2 /> Delete
          </Button>
          <Button className="gap-1.5 max-md:h-11" disabled={!view} onClick={() => setWalletsOpen(true)}>
            <Wallet /> Add to wallets
          </Button>
        </div>
      </div>

      {wallet && wallet.warnings.length > 0 && (
        <div role="alert" className="flex flex-col gap-2 rounded-[14px] border border-warn/30 bg-warn-soft p-3.5 text-[13px] text-[#f0dcae]">
          {wallet.warnings.map((w) => (
            <p key={w} className="flex items-start gap-2.5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      <CombinedWalletPanel runId={runId} viewId={viewId} refreshKey={refreshKey} onLoaded={setWallet} />

      {wallet && (
        <section className="flex flex-col gap-3 md:gap-0 md:overflow-hidden md:rounded-[20px] md:border md:border-border md:bg-card">
          <div className="flex items-center justify-between gap-2 px-1 md:border-b md:border-border md:px-5 md:py-3.5">
            <b className="text-[15px] font-semibold">Addresses in this view</b>
            <Button variant="ghost" size="sm" className="gap-1.5 text-text-2" onClick={() => void copyAll()}>
              <Copy /> Copy addresses
            </Button>
          </div>

          {/* Phone: one card per address. */}
          <div className="flex flex-col gap-3 md:hidden">
            {wallet.perAddress.map((a) => (
              <article key={a.address} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/backtest/${runId}/${a.address}`} className="font-mono text-[13px] font-semibold" title={a.address}>
                    {short(a.address)}
                  </Link>
                  <b className={cn("font-semibold tabular-nums", pnlTone(a.pnlUsd))}>{a.trades + a.open > 0 ? formatUsd(a.pnlUsd) : "—"}</b>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-text-3">
                  <span>
                    {a.trades.toLocaleString()} trades{a.open > 0 ? ` +${a.open} open` : ""} · {a.wins}W / {a.losses}L
                  </span>
                  <span>
                    fees {formatUsd(a.feesUsd)} · {totalPnl > 0 && a.pnlUsd > 0 ? `${((a.pnlUsd / totalPnl) * 100).toFixed(0)}% of P&L` : "—"}
                  </span>
                </div>
              </article>
            ))}
            <div className="flex items-center justify-between rounded-2xl border border-line-2 bg-surface-2 px-4 py-3.5">
              <b className="text-sm font-semibold">Total</b>
              <div className="flex flex-col items-end">
                <b className={cn("font-semibold tabular-nums", pnlTone(totalPnl))}>{formatUsd(totalPnl)}</b>
                <span className="text-xs text-text-3">{wallet.perAddress.reduce((n, a) => n + a.trades, 0).toLocaleString()} trades · fees {formatUsd(wallet.feesUsd)}</span>
              </div>
            </div>
          </div>

          {/* Wide screens: the table. */}
          <div className="max-md:hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={cn(headCls, "pl-5")}>Address</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Closed trades</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Win / loss</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Fees paid</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>P&amp;L</TableHead>
                  <TableHead className={cn(headCls, "pr-5 text-right")}>Share of P&amp;L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallet.perAddress.map((a) => (
                  <TableRow key={a.address} className="h-[56px] border-border">
                    <TableCell className="pl-5 font-mono text-xs">
                      <Link href={`/backtest/${runId}/${a.address}`} className="hover:text-primary" title={a.address}>
                        {short(a.address)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">
                      {a.trades.toLocaleString()}
                      {a.open > 0 && <span className="text-xs text-text-3"> +{a.open} open</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {a.wins}W / {a.losses}L
                    </TableCell>
                    <TableCell className="text-right text-[13px] text-text-3 tabular-nums">{formatUsd(a.feesUsd)}</TableCell>
                    <TableCell className={cn("text-right text-[13px] font-semibold tabular-nums", pnlTone(a.pnlUsd))}>{a.trades + a.open > 0 ? formatUsd(a.pnlUsd) : "—"}</TableCell>
                    <TableCell className="pr-5 text-right text-[13px] text-text-3 tabular-nums">{totalPnl > 0 && a.pnlUsd > 0 ? `${((a.pnlUsd / totalPnl) * 100).toFixed(0)}%` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className="bg-transparent">
                <TableRow className="h-14 border-line-2 hover:bg-transparent">
                  <TableCell className="pl-5 text-[13px] font-semibold">Total</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums">{wallet.perAddress.reduce((n, a) => n + a.trades, 0).toLocaleString()}</TableCell>
                  <TableCell />
                  <TableCell className="text-right text-[13px] text-text-3 tabular-nums">{formatUsd(wallet.feesUsd)}</TableCell>
                  <TableCell className={cn("text-right text-[13px] font-semibold tabular-nums", pnlTone(totalPnl))}>{formatUsd(totalPnl)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <Note className="px-1 md:px-5 md:pb-4">
            Worked out from the trades the backtest already simulated (it is {wallet.sourceStatus}), so nothing was fetched again. Each trade keeps its entry, exit and price move from the backtest; its amount and fees are this view&apos;s. A view always follows its backtest: when more addresses finish or are added, reopen it to see the new totals.
          </Note>
        </section>
      )}

      {editOpen && view && src && (
        <NewViewDialog runId={runId} source={src} suggestedBalanceUsd={view.startingBalanceUsd} editing={view} open onOpenChange={setEditOpen} onSaved={() => setRefreshKey((k) => k + 1)} />
      )}

      {walletsOpen && view && <AddViewsToWalletsDialog runId={runId} views={[view]} open onOpenChange={setWalletsOpen} />}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this combined view?</AlertDialogTitle>
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
