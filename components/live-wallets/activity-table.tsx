"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, Coins, ExternalLink, RefreshCw, TrendingDown, TrendingUp, Trophy, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatTile } from "@/components/traders/stat-tile";
import { formatAmount, PnlPill, signedUsd, toneOf, TokenAvatar, TypePill } from "./shared";
import { getLiveWalletTransactions } from "@/lib/live-wallet-api";
import { formatRelativeTime, formatSol, formatUsd } from "@/lib/format";
import type { LiveTransaction, LiveTransactionsPage, LiveTxKind } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

type Pill = "buy" | "sell" | "receive" | "send" | "neutral" | "failed";

const KIND_META: Record<LiveTxKind, { label: string; pill: Pill; icon: typeof ArrowDownLeft; tint: string }> = {
  buy: { label: "Bought", pill: "buy", icon: ArrowLeftRight, tint: "bg-positive/15 text-positive" },
  sell: { label: "Sold", pill: "sell", icon: ArrowLeftRight, tint: "bg-[#ff8a5b]/15 text-[#ff9b6e]" },
  receive: { label: "Received", pill: "receive", icon: ArrowDownLeft, tint: "bg-primary/15 text-brand-soft" },
  send: { label: "Sent", pill: "send", icon: ArrowUpRight, tint: "bg-[#9a97b3]/15 text-[#b8b5d0]" },
  sol_in: { label: "SOL in", pill: "receive", icon: Coins, tint: "bg-primary/15 text-brand-soft" },
  sol_out: { label: "SOL out", pill: "send", icon: Coins, tint: "bg-[#9a97b3]/15 text-[#b8b5d0]" },
  other: { label: "Other", pill: "neutral", icon: CircleAlert, tint: "bg-[#9a97b3]/15 text-[#b8b5d0]" },
  failed: { label: "Failed", pill: "failed", icon: CircleAlert, tint: "bg-negative/15 text-negative" },
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "buy", label: "Bought" },
  { value: "sell", label: "Sold" },
  { value: "receive", label: "Received" },
  { value: "send", label: "Sent" },
  { value: "sol_in", label: "SOL in" },
  { value: "sol_out", label: "SOL out" },
  { value: "failed", label: "Failed" },
];

const PAGE_SIZE = 25;

/** The figures shown for one transaction, shared by the table and the list so they never disagree. */
function describe(tx: LiveTransaction) {
  const hasToken = tx.mint !== null;
  const solMove = tx.kind === "sol_in" || tx.kind === "sol_out";
  const symbol = tx.symbol ?? (tx.mint ? tx.mint.slice(0, 6) : "SOL");
  const amount = hasToken ? `${tx.tokenDelta > 0 ? "+" : ""}${formatAmount(tx.tokenDelta)}` : solMove ? `${tx.solDelta > 0 ? "+" : ""}${formatSol(tx.solDelta)}` : "-";
  // Only a real swap has a price. A transfer has none, so it says so instead of showing a made-up number.
  const swapped = tx.kind === "buy" || tx.kind === "sell";
  const value = tx.valueUsd !== null && (swapped || solMove) ? formatUsd(tx.valueUsd) : tx.kind === "receive" || tx.kind === "send" ? "No price" : "-";
  const sol = swapped ? `${tx.solDelta > 0 ? "+" : ""}${formatSol(tx.solDelta)}` : null;
  return { hasToken, solMove, symbol, amount, value, sol, swapped };
}

function KindIcon({ kind }: { kind: LiveTxKind }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", meta.tint)}>
      <Icon className="size-5" />
    </span>
  );
}

function amountTone(tx: LiveTransaction) {
  if (tx.kind === "buy") return "text-positive";
  if (tx.kind === "receive" || tx.kind === "sol_in") return "text-brand-soft";
  return "text-foreground";
}

function TxLink({ signature }: { signature: string }) {
  return (
    <a
      href={`https://solscan.io/tx/${signature}`}
      target="_blank"
      rel="noreferrer"
      aria-label="View transaction on Solscan"
      className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      <ExternalLink className="size-3.5" />
    </a>
  );
}

function ListRow({ tx, showToken, onSelectToken }: { tx: LiveTransaction; showToken: boolean; onSelectToken?: (mint: string) => void }) {
  const meta = KIND_META[tx.kind];
  const d = describe(tx);
  const title = showToken ? `${meta.label} ${d.hasToken ? d.symbol : ""}`.trim() : meta.label;
  const content = (
    <>
      <KindIcon kind={tx.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold">{title}</div>
        <div className="text-xs text-muted-foreground" title={tx.blockTime ? new Date(tx.blockTime).toLocaleString() : undefined}>
          {formatRelativeTime(tx.blockTime)}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <div className={cn("text-[15px] font-bold tabular-nums", amountTone(tx))}>{d.amount}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{d.sol ? `${d.sol} · ${d.value}` : d.value}</div>
        {tx.kind === "sell" && tx.realizedPnlUsd !== null ? <PnlPill usd={tx.realizedPnlUsd} pct={tx.realizedPnlPct} className="mt-1" /> : null}
      </div>
    </>
  );
  const clickable = d.hasToken && onSelectToken && showToken;
  return (
    <li className="border-b border-border last:border-0">
      {clickable ? (
        <button type="button" onClick={() => onSelectToken!(tx.mint!)} className="flex w-full items-center gap-3 py-3 text-left">
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-3 py-3">{content}</div>
      )}
    </li>
  );
}

function TableRowTx({ tx, showToken, onSelectToken }: { tx: LiveTransaction; showToken: boolean; onSelectToken?: (mint: string) => void }) {
  const meta = KIND_META[tx.kind];
  const d = describe(tx);
  return (
    <TableRow className="h-16">
      <TableCell className="pl-5">
        <TypePill label={meta.label} tone={meta.pill} />
        <div className="mt-1 text-xs text-muted-foreground" title={tx.blockTime ? new Date(tx.blockTime).toLocaleString() : undefined}>
          {formatRelativeTime(tx.blockTime)}
        </div>
      </TableCell>
      {showToken ? (
        <TableCell>
          {d.hasToken ? (
            <button type="button" onClick={() => onSelectToken?.(tx.mint!)} className="flex items-center gap-2.5 text-left hover:text-brand-soft">
              <TokenAvatar icon={tx.icon} symbol={tx.symbol} className="size-7" />
              <span className="max-w-28 truncate font-extrabold">{d.symbol}</span>
            </button>
          ) : (
            <span className="flex items-center gap-2.5 text-muted-foreground">
              <Wallet className="size-4" /> SOL
            </span>
          )}
        </TableCell>
      ) : null}
      <TableCell className={cn("text-right font-semibold tabular-nums", amountTone(tx))}>{d.amount}</TableCell>
      <TableCell className="text-right tabular-nums">
        <div className={cn(d.value === "No price" ? "text-muted-foreground" : "font-semibold")}>{d.value}</div>
        {d.sol ? <div className="text-xs text-muted-foreground">{d.sol}</div> : null}
      </TableCell>
      <TableCell className="text-right">{tx.kind === "sell" && tx.realizedPnlUsd !== null ? <PnlPill usd={tx.realizedPnlUsd} pct={tx.realizedPnlPct} /> : <span className="text-muted-foreground">-</span>}</TableCell>
      <TableCell className="pr-4 text-right">
        <TxLink signature={tx.signature} />
      </TableCell>
    </TableRow>
  );
}

/**
 * The wallet's transaction history, newest first, with the profit/loss of every sell. `mint` narrows it to one token.
 * `layout="auto"` is a table from tablet width up and a list on phones; `layout="list"` is always the list (for narrow
 * panels). `showSummary` adds the profit/loss tiles above. Opening it also brings the stored history up to date from the chain.
 */
export function ActivityTable({
  walletId,
  mint,
  onSelectToken,
  refreshKey = 0,
  layout = "auto",
  showSummary = true,
}: {
  walletId: string;
  mint?: string;
  onSelectToken?: (mint: string) => void;
  refreshKey?: number;
  layout?: "auto" | "list";
  showSummary?: boolean;
}) {
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
  const showToken = !mint;
  const listOnly = layout === "list";

  return (
    <div className="flex flex-col gap-4">
      {showSummary ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Total profit" value={signedUsd(s?.profitUsd ?? 0)} icon={TrendingUp} tone={s?.profitUsd ? "positive" : "default"} hint={`${s?.wins ?? 0} winning sell${s?.wins === 1 ? "" : "s"}`} />
          <StatTile label="Total loss" value={signedUsd(s?.lossUsd ?? 0)} icon={TrendingDown} tone={s?.lossUsd ? "negative" : "default"} hint={`${s?.losses ?? 0} losing sell${s?.losses === 1 ? "" : "s"}`} />
          <StatTile label="Net realized P&L" value={signedUsd(s?.realizedPnlUsd ?? 0)} icon={Wallet} tone={toneOf(s?.realizedPnlUsd)} hint={`${s?.buys ?? 0} buys · ${s?.sells ?? 0} sells`} />
          <StatTile label="Win rate" value={decided ? `${Math.round(((s?.wins ?? 0) / decided) * 100)}%` : "-"} icon={Trophy} hint={decided ? `${s?.wins} won of ${decided} closed` : "no closed trades yet"} />
        </div>
      ) : null}

      {/* Filter chips: one row that scrolls sideways on narrow screens instead of wrapping into a mess. */}
      <div className="flex items-center gap-2">
        <div role="group" aria-label="Filter activity" className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => {
                setFilter(f.value);
                setPage(1);
              }}
              className={cn(
                "h-9 shrink-0 rounded-full border px-4 text-sm font-bold transition-colors",
                filter === f.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" onClick={load} aria-label="Refresh transactions">
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {data ? <div className="-mt-2 text-xs text-muted-foreground">{`${data.total} transaction${data.total === 1 ? "" : "s"}`}</div> : null}

      <Card className="gap-0 py-0">
        {error && !data ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : loading && !data ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : !data || data.transactions.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">No transactions yet.</div>
        ) : (
          <>
            <ul className={cn("px-4", !listOnly && "md:hidden")}>
              {data.transactions.map((tx) => (
                <ListRow key={`${tx.signature}-${tx.mint ?? "sol"}`} tx={tx} showToken={showToken} onSelectToken={onSelectToken} />
              ))}
            </ul>
            {!listOnly ? (
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5">Type</TableHead>
                      {showToken ? <TableHead>Token</TableHead> : null}
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Profit / loss</TableHead>
                      <TableHead className="pr-4 text-right">
                        <span className="sr-only">Transaction</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.transactions.map((tx) => (
                      <TableRowTx key={`${tx.signature}-${tx.mint ?? "sol"}`} tx={tx} showToken={showToken} onSelectToken={onSelectToken} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </>
        )}
        {data && data.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm text-muted-foreground">
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {data?.syncError ? <p className="text-xs text-muted-foreground">Sync note: {data.syncError}</p> : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Tokens sent to you or sent out have no purchase price, so they never count as profit or loss. Only buys and sells do. Profit and loss uses the average cost of the tokens sold, after the network fee. USD values use the SOL price when each transaction was synced.
      </p>
    </div>
  );
}
