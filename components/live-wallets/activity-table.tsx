"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, Flame, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, Coins, ExternalLink, RefreshCw, TrendingDown, TrendingUp, Trophy, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
  buy: { label: "Bought", pill: "buy", icon: ArrowLeftRight, tint: "bg-pos-soft text-positive" },
  sell: { label: "Sold", pill: "sell", icon: ArrowLeftRight, tint: "bg-warn-soft text-warn" },
  receive: { label: "Received", pill: "receive", icon: ArrowDownLeft, tint: "bg-volt-soft text-primary" },
  send: { label: "Sent", pill: "send", icon: ArrowUpRight, tint: "bg-surface-3 text-text-2" },
  burn: { label: "Burned", pill: "failed", icon: Flame, tint: "bg-neg-soft text-destructive" },
  sol_in: { label: "SOL in", pill: "receive", icon: Coins, tint: "bg-volt-soft text-primary" },
  sol_out: { label: "SOL out", pill: "send", icon: Coins, tint: "bg-surface-3 text-text-2" },
  other: { label: "Other", pill: "neutral", icon: CircleAlert, tint: "bg-surface-3 text-text-2" },
  failed: { label: "Failed", pill: "failed", icon: CircleAlert, tint: "bg-neg-soft text-destructive" },
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "buy", label: "Bought" },
  { value: "sell", label: "Sold" },
  { value: "receive", label: "Received" },
  { value: "send", label: "Sent" },
  { value: "burn", label: "Burned" },
  { value: "sol_in", label: "SOL in" },
  { value: "sol_out", label: "SOL out" },
  { value: "failed", label: "Failed" },
];

// The SOL panel has no token transfers, so it offers SOL-shaped filters instead.
const SOL_FILTERS = [
  { value: "all", label: "All" },
  { value: "buy", label: "Bought" },
  { value: "sell", label: "Sold" },
  { value: "sol_in", label: "SOL in" },
  { value: "sol_out", label: "SOL out" },
  { value: "failed", label: "Failed" },
];

const PAGE_SIZE = 25;
const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

/** The figures shown for one transaction, shared by the table and the list so they never disagree. */
function describe(tx: LiveTransaction) {
  const hasToken = tx.mint !== null;
  const solMove = tx.kind === "sol_in" || tx.kind === "sol_out";
  const symbol = tx.symbol ?? (tx.mint ? tx.mint.slice(0, 6) : "SOL");
  const amount = hasToken ? `${tx.tokenDelta > 0 ? "+" : ""}${formatAmount(tx.tokenDelta)}` : solMove ? `${tx.solDelta > 0 ? "+" : ""}${formatSol(tx.solDelta)}` : "-";
  // Only a real swap has a price. A transfer has none, so it says so instead of showing a made-up number.
  const swapped = tx.kind === "buy" || tx.kind === "sell";
  const value = tx.valueUsd !== null && (swapped || solMove) ? formatUsd(tx.valueUsd) : tx.kind === "receive" || tx.kind === "send" || tx.kind === "burn" ? "No price" : "-";
  const sol = swapped ? `${tx.solDelta > 0 ? "+" : ""}${formatSol(tx.solDelta)}` : null;
  return { hasToken, solMove, symbol, amount, value, sol, swapped };
}

function KindIcon({ kind }: { kind: LiveTxKind }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", meta.tint)}>
      <Icon className="size-5" />
    </span>
  );
}

function amountTone(tx: LiveTransaction) {
  if (tx.kind === "buy") return "text-positive";
  if (tx.kind === "receive" || tx.kind === "sol_in") return "text-primary";
  return "text-foreground";
}

function TxLink({ signature }: { signature: string }) {
  return (
    <a
      href={`https://solscan.io/tx/${signature}`}
      target="_blank"
      rel="noreferrer"
      aria-label="View transaction on Solscan"
      className="inline-flex size-8 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-accent hover:text-foreground"
    >
      <ExternalLink className="size-3.5" />
    </a>
  );
}

/** The same transaction seen from the wallet's SOL balance: what SOL went out or came in, and what it was for. */
function describeSol(tx: LiveTransaction) {
  const d = describe(tx);
  const token = tx.symbol ?? (tx.mint ? tx.mint.slice(0, 6) : "");
  const moved = tx.kind === "other" || tx.kind === "failed" ? -tx.feeSol : tx.solDelta;
  const title = tx.kind === "buy" ? `Bought ${token}` : tx.kind === "sell" ? `Sold ${token}` : tx.kind === "sol_in" ? "SOL received" : tx.kind === "sol_out" ? "SOL sent" : tx.kind === "failed" ? "Failed transaction" : "Network fee";
  const amount = `${moved > 0 ? "+" : ""}${formatSol(moved)}`;
  const detail = d.swapped ? `${tx.tokenDelta > 0 ? "+" : ""}${formatAmount(tx.tokenDelta)} ${token}` : d.value === "No price" || d.value === "-" ? "" : d.value;
  return { title, amount, detail, moved };
}

function ListRow({ tx, showToken, onSelectToken, solView }: { tx: LiveTransaction; showToken: boolean; onSelectToken?: (mint: string) => void; solView?: boolean }) {
  const meta = KIND_META[tx.kind];
  const d = describe(tx);
  const sol = solView ? describeSol(tx) : null;
  const title = sol ? sol.title : showToken ? `${meta.label} ${d.hasToken ? d.symbol : ""}`.trim() : meta.label;
  const amountText = sol ? sol.amount : d.amount;
  const amountClass = sol ? (sol.moved > 0 ? "text-positive" : "text-foreground") : amountTone(tx);
  const subText = sol ? sol.detail : d.sol ? `${d.sol} · ${d.value}` : d.value;
  const content = (
    <>
      <KindIcon kind={tx.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{title}</div>
        <div className="text-xs text-text-3" title={tx.blockTime ? new Date(tx.blockTime).toLocaleString() : undefined}>
          {formatRelativeTime(tx.blockTime)}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
        <div className={cn("text-[15px] font-semibold tabular-nums", amountClass)}>{amountText}</div>
        {subText ? <div className="text-xs text-text-3 tabular-nums">{subText}</div> : null}
        {tx.kind === "sell" && tx.realizedPnlUsd !== null ? <PnlPill usd={tx.realizedPnlUsd} pct={tx.realizedPnlPct} className="mt-1" /> : null}
      </div>
    </>
  );
  const clickable = d.hasToken && onSelectToken && showToken && !solView;
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
    <TableRow className="h-16 border-border">
      <TableCell className="pl-5">
        <TypePill label={meta.label} tone={meta.pill} />
        <div className="mt-1 text-xs text-text-3" title={tx.blockTime ? new Date(tx.blockTime).toLocaleString() : undefined}>
          {formatRelativeTime(tx.blockTime)}
        </div>
      </TableCell>
      {showToken ? (
        <TableCell>
          {d.hasToken ? (
            <button type="button" onClick={() => onSelectToken?.(tx.mint!)} className="flex items-center gap-2.5 text-left hover:text-primary">
              <TokenAvatar icon={tx.icon} symbol={tx.symbol} className="size-7" />
              <span className="max-w-28 truncate text-[13px] font-semibold">{d.symbol}</span>
            </button>
          ) : (
            <span className="flex items-center gap-2.5 text-text-3">
              <Wallet className="size-4" /> SOL
            </span>
          )}
        </TableCell>
      ) : null}
      <TableCell className={cn("text-right font-semibold tabular-nums", amountTone(tx))}>{d.amount}</TableCell>
      <TableCell className="text-right tabular-nums">
        <div className={cn(d.value === "No price" ? "text-text-3" : "font-semibold")}>{d.value}</div>
        {d.sol ? <div className="text-xs text-text-3">{d.sol}</div> : null}
      </TableCell>
      <TableCell className="text-right">{tx.kind === "sell" && tx.realizedPnlUsd !== null ? <PnlPill usd={tx.realizedPnlUsd} pct={tx.realizedPnlPct} /> : <span className="text-text-3">—</span>}</TableCell>
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
  const showToken = !mint || mint === "SOL";
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
          {(mint === "SOL" ? SOL_FILTERS : FILTERS).map((f) => (
            <Chip
              key={f.value}
              active={filter === f.value}
              onClick={() => {
                setFilter(f.value);
                setPage(1);
              }}
            >
              {f.label}
            </Chip>
          ))}
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 text-text-3 max-md:size-10" onClick={load} aria-label="Refresh transactions">
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {data ? <div className="-mt-2 text-xs text-text-3">{`${data.total} transaction${data.total === 1 ? "" : "s"}`}</div> : null}

      <div className="overflow-hidden rounded-[20px] border border-border bg-card">
        {error && !data ? (
          <div className="p-6 text-sm text-destructive" role="alert">{error}</div>
        ) : loading && !data ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : !data || data.transactions.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-text-3">No transactions yet.</div>
        ) : (
          <>
            <ul className={cn("px-4", !listOnly && "md:hidden")}>
              {data.transactions.map((tx) => (
                <ListRow key={`${tx.signature}-${tx.mint ?? "sol"}`} tx={tx} showToken={showToken} onSelectToken={onSelectToken} solView={mint === "SOL"} />
              ))}
            </ul>
            {!listOnly ? (
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead className={cn(headCls, "pl-5")}>Type</TableHead>
                      {showToken ? <TableHead className={headCls}>Token</TableHead> : null}
                      <TableHead className={cn(headCls, "text-right")}>Amount</TableHead>
                      <TableHead className={cn(headCls, "text-right")}>Value</TableHead>
                      <TableHead className={cn(headCls, "text-right")}>Profit / loss</TableHead>
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
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[13px] text-text-2">
            <span>
              Page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {data?.syncError ? <p className="text-xs text-text-3">Sync note: {data.syncError}</p> : null}
      <p className="text-xs leading-[18px] text-text-3">
        Tokens sent to you or sent out have no purchase price, so they never count as profit or loss. Only buys and sells do. Profit and loss uses the average cost of the tokens sold, after the network fee. USD values use the SOL price when each transaction was synced.
      </p>
    </div>
  );
}
