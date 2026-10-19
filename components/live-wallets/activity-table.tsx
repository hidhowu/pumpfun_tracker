"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, TrendingDown, TrendingUp, Trophy, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/traders/stat-tile";
import { AddressChip, formatAmount, formatPrice, signedPercent, signedUsd, toneClass, toneOf, TokenAvatar } from "./shared";
import { getLiveWalletTransactions } from "@/lib/live-wallet-api";
import { formatRelativeTime, formatSol, formatUsd } from "@/lib/format";
import type { LiveTransaction, LiveTransactionsPage, LiveTxKind } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

const KIND_META: Record<LiveTxKind, { label: string; className: string }> = {
  buy: { label: "Buy", className: "border-positive/30 text-positive" },
  sell: { label: "Sell", className: "border-negative/30 text-negative" },
  receive: { label: "Received", className: "border-border/60 text-muted-foreground" },
  send: { label: "Sent", className: "border-border/60 text-muted-foreground" },
  sol_in: { label: "SOL in", className: "border-border/60 text-muted-foreground" },
  sol_out: { label: "SOL out", className: "border-border/60 text-muted-foreground" },
  other: { label: "Other", className: "border-border/60 text-muted-foreground" },
  failed: { label: "Failed", className: "border-negative/30 text-negative" },
};

const FILTERS = [
  { value: "all", label: "All activity" },
  { value: "buy", label: "Buys" },
  { value: "sell", label: "Sells" },
  { value: "receive", label: "Received" },
  { value: "send", label: "Sent" },
  { value: "sol_in", label: "SOL in" },
  { value: "sol_out", label: "SOL out" },
  { value: "failed", label: "Failed" },
];

const PAGE_SIZE = 25;

function Row({ tx, showToken, onSelectToken }: { tx: LiveTransaction; showToken: boolean; onSelectToken?: (mint: string) => void }) {
  const meta = KIND_META[tx.kind];
  const isSell = tx.kind === "sell";
  const hasToken = tx.mint !== null;
  const solMove = tx.kind === "sol_in" || tx.kind === "sol_out";
  return (
    <TableRow className="border-border/60">
      <TableCell className="pl-4 whitespace-nowrap">
        <Badge variant="outline" className={meta.className}>
          {meta.label}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground" title={tx.blockTime ? new Date(tx.blockTime).toLocaleString() : undefined}>
        {formatRelativeTime(tx.blockTime)}
      </TableCell>
      {showToken ? (
        <TableCell>
          {hasToken ? (
            <button type="button" onClick={() => onSelectToken?.(tx.mint!)} className="flex items-center gap-2 text-left hover:text-primary">
              <TokenAvatar icon={tx.icon} symbol={tx.symbol} className="size-6" />
              <span className="max-w-28 truncate font-medium">{tx.symbol ?? tx.mint!.slice(0, 6)}</span>
            </button>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="size-4" /> SOL
            </span>
          )}
        </TableCell>
      ) : null}
      <TableCell className={cn("text-right tabular-nums", tx.tokenDelta > 0 && "text-positive", tx.tokenDelta < 0 && "text-negative")}>
        {hasToken ? `${tx.tokenDelta > 0 ? "+" : ""}${formatAmount(tx.tokenDelta)}` : solMove ? `${tx.solDelta > 0 ? "+" : ""}${formatSol(tx.solDelta)}` : "-"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{formatPrice(tx.priceUsd)}</TableCell>
      <TableCell className="text-right tabular-nums">{tx.valueUsd !== null && (tx.kind === "buy" || tx.kind === "sell" || solMove) ? formatUsd(tx.valueUsd) : "-"}</TableCell>
      <TableCell className={cn("text-right tabular-nums", toneClass(tx.realizedPnlUsd))}>
        {isSell && tx.realizedPnlUsd !== null ? (
          <span className="inline-flex flex-col items-end">
            <span>{signedUsd(tx.realizedPnlUsd)}</span>
            <span className="text-[11px] opacity-80">{signedPercent(tx.realizedPnlPct)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <AddressChip value={tx.signature} kind="tx" label="transaction signature" chars={4} />
      </TableCell>
    </TableRow>
  );
}

/**
 * The wallet's transaction history, newest first, with the profit/loss of every sell and a summary of the whole list
 * (or of one token when `mint` is set). Opening it also brings the stored history up to date from the chain.
 */
export function ActivityTable({ walletId, mint, onSelectToken, refreshKey = 0 }: { walletId: string; mint?: string; onSelectToken?: (mint: string) => void; refreshKey?: number }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LiveTransactionsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getLiveWalletTransactions(walletId, { mint, kind: filter === "all" ? undefined : filter, page, limit: PAGE_SIZE }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [walletId, mint, filter, page]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20_000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  const s = data?.summary;
  const decided = s ? s.wins + s.losses : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total profit" value={signedUsd(s?.profitUsd ?? 0)} icon={TrendingUp} tone={s?.profitUsd ? "positive" : "default"} hint={`${s?.wins ?? 0} winning sell${s?.wins === 1 ? "" : "s"}`} />
        <StatTile label="Total loss" value={signedUsd(s?.lossUsd ?? 0)} icon={TrendingDown} tone={s?.lossUsd ? "negative" : "default"} hint={`${s?.losses ?? 0} losing sell${s?.losses === 1 ? "" : "s"}`} />
        <StatTile label="Net realized P&L" value={signedUsd(s?.realizedPnlUsd ?? 0)} icon={Wallet} tone={toneOf(s?.realizedPnlUsd)} hint={`${s?.buys ?? 0} buys · ${s?.sells ?? 0} sells`} />
        <StatTile label="Win rate" value={decided ? `${Math.round(((s?.wins ?? 0) / decided) * 100)}%` : "-"} icon={Trophy} hint={decided ? `${s?.wins} won of ${decided} closed` : "no closed trades yet"} />
      </div>

      <Card className="overflow-hidden border-border/60">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Select
              value={filter}
              onValueChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">{data ? `${data.total} transaction${data.total === 1 ? "" : "s"}` : ""}</span>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={load}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        </div>
        <CardContent className="p-0">
          {error && !data ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : loading && !data ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : !data || data.transactions.length === 0 ? (
            <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">No transactions yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="pl-4">Type</TableHead>
                  <TableHead>Time</TableHead>
                  {!mint ? <TableHead>Token</TableHead> : null}
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Profit / loss</TableHead>
                  <TableHead className="pr-4 text-right">Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transactions.map((tx) => (
                  <Row key={`${tx.signature}-${tx.mint ?? "sol"}`} tx={tx} showToken={!mint} onSelectToken={onSelectToken} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        {data && data.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-sm text-muted-foreground">
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="size-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-8" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {data?.syncError ? <p className="text-xs text-muted-foreground">Sync note: {data.syncError}</p> : null}
      <p className="text-xs text-muted-foreground">
        Profit/loss uses the average cost of the tokens sold, after the network fee. Tokens received by transfer count as zero cost. USD values use the SOL price when each transaction was synced.
      </p>
    </div>
  );
}
