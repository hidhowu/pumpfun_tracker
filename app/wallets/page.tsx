"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, OctagonAlert, Search, TriangleAlert, Wallet as WalletIcon, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { traderTint } from "@/components/traders/trader-avatar";
import { CreateWalletDialog, DuplicateWalletDialog } from "@/components/wallets/wallet-dialogs";
import { PanicBar } from "@/components/wallets/panic-bar";
import { listWallets } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { WalletView } from "@/lib/types";
import { cn } from "@/lib/utils";

type SortKey = "name" | "balance" | "today" | "lifetime" | "traders" | "trades";
type SortDir = "asc" | "desc";

const SORT_ACCESSORS: Record<SortKey, (w: WalletView) => number | string> = {
  name: (w) => w.name.toLowerCase(),
  balance: (w) => w.balanceUsd,
  today: (w) => w.todayRealizedPnlUsd ?? 0,
  lifetime: (w) => w.realizedPnlUsd,
  traders: (w) => w.traderCount ?? 0,
  trades: (w) => w.openPositionCount + w.closedPositionCount,
};

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-text-3");
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function WalletAvatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center font-mono font-semibold text-primary-foreground", size === "lg" ? "size-12 rounded-[15px] text-sm" : "size-9 rounded-xl text-xs")}
      style={{ background: traderTint(name) }}
    >
      {name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}

function LinkedBadge() {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border border-volt-line bg-volt-soft px-2 text-[11px] font-medium text-primary">
      <Zap className="size-3" /> Linked to live
    </span>
  );
}

function SortHead({ label, sortKey, activeKey, dir, onSort, align = "right", className }: { label: string; sortKey: SortKey; activeKey: SortKey; dir: SortDir; onSort: (k: SortKey) => void; align?: "left" | "right"; className?: string }) {
  const active = activeKey === sortKey;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={cn(align === "right" && "text-right", className)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.07em] uppercase transition-colors hover:text-foreground", align === "right" && "flex-row-reverse", active ? "text-foreground" : "text-text-3")}
      >
        {label}
        <Icon className={cn("size-3", active ? "text-primary" : "opacity-50")} />
      </button>
    </TableHead>
  );
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("lifetime");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const refresh = useCallback(async () => {
    try {
      const { wallets } = await listWallets();
      setWallets(wallets);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
      toast.error(e instanceof Error ? e.message : "Failed to load wallets");
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (wallets ?? []).filter((w) => !q || w.name.toLowerCase().includes(q));
    const accessor = SORT_ACCESSORS[sortKey];
    const sorted = [...filtered].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [wallets, query, sortKey, sortDir]);

  const totalBalance = (wallets ?? []).reduce((sum, w) => sum + w.balanceUsd, 0);
  const totalStart = (wallets ?? []).reduce((sum, w) => sum + w.startingBalanceUsd, 0);
  const totalToday = (wallets ?? []).reduce((sum, w) => sum + (w.todayRealizedPnlUsd ?? 0), 0);
  const panicWallets = (wallets ?? []).filter((w) => w.panic?.panic);
  const hasWallets = !!wallets && wallets.length > 0;

  const help = <HelpTip>Independent practice wallets with fake money. Each follows its own traders and rules.</HelpTip>;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex items-end justify-between gap-3">
        <h1 className="hidden text-[28px] leading-[34px] font-semibold tracking-[-0.025em] md:block">
          Sim wallets
          {help}
        </h1>
        <span className="flex items-center gap-1 text-[13px] text-text-3 md:hidden">
          Practice wallets with fake money
          {help}
        </span>
        <CreateWalletDialog onCreated={refresh} triggerClassName="max-md:hidden" />
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <b>Couldn&apos;t load the wallets.</b> {wallets ? "Showing the last data received." : "Try again in a moment."}
          </span>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}

      {wallets && hasWallets && (
        <>
          {/* Desktop: four tiles. */}
          <div className="grid grid-cols-4 gap-4 max-md:hidden">
            <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card px-5 py-[18px]">
              <span className="text-[13px] text-text-2">Wallets</span>
              <b className="text-[26px] leading-8 font-semibold tracking-[-0.02em] tabular-nums">{wallets.length}</b>
            </div>
            <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card px-5 py-[18px]">
              <span className="text-[13px] text-text-2">Total balance</span>
              <b className="text-[26px] leading-8 font-semibold tracking-[-0.02em] tabular-nums">{formatUsd(totalBalance)}</b>
              <span className="text-xs text-text-3">of {formatUsd(totalStart)} started</span>
            </div>
            <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card px-5 py-[18px]">
              <span className="text-[13px] text-text-2">Today</span>
              <b className={cn("text-[26px] leading-8 font-semibold tracking-[-0.02em] tabular-nums", tone(totalToday))}>{signedUsd(totalToday)}</b>
            </div>
            <div className={cn("flex flex-col gap-2.5 rounded-[20px] border px-5 py-[18px]", panicWallets.length > 0 ? "border-destructive/40 bg-neg-soft" : "border-border bg-card")}>
              <span className={cn("text-[13px]", panicWallets.length > 0 ? "text-negative" : "text-text-2")}>Needs attention</span>
              <b className={cn("text-[26px] leading-8 font-semibold tracking-[-0.02em]", panicWallets.length > 0 ? "text-negative" : "text-positive")}>{panicWallets.length > 0 ? `${panicWallets.length} in panic` : "All calm"}</b>
              <span className="text-xs text-text-2">{panicWallets.length > 0 ? "Fell further from its peak than allowed" : "No wallet is near its panic level"}</span>
            </div>
          </div>

          {/* Phone: the alert (if any) and one total balance. */}
          <div className="flex flex-col gap-3 md:hidden">
            {panicWallets.length > 0 && (
              <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
                <OctagonAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>
                  <b className="text-foreground">
                    {panicWallets.length} wallet{panicWallets.length === 1 ? "" : "s"} in panic.
                  </b>{" "}
                  {panicWallets.map((w) => w.name).join(", ")} fell past {panicWallets.length === 1 ? "its" : "their"} limit.
                </span>
              </div>
            )}
            <div className="flex flex-col gap-1 rounded-[20px] border border-border bg-card px-5 py-[18px]">
              <span className="text-sm text-text-2">Total balance</span>
              <b className="text-[32px] leading-10 font-semibold tracking-[-0.025em] tabular-nums">{formatUsd(totalBalance)}</b>
              <span className={cn("mt-1 inline-flex h-[22px] w-fit items-center rounded-full border px-2 text-[11.5px] font-medium", totalToday > 0 ? "border-positive/30 bg-pos-soft text-positive" : totalToday < 0 ? "border-destructive/30 bg-neg-soft text-destructive" : "border-line-2 bg-surface-3 text-text-2")}>
                {signedUsd(totalToday)} today
              </span>
            </div>
          </div>
        </>
      )}

      {wallets === null ? (
        !loadError && (
          <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        )
      ) : !hasWallets ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <WalletIcon className="size-6" />
          </span>
          <b className="text-[15px] font-semibold">No wallets yet — create one to start.</b>
          <CreateWalletDialog onCreated={refresh} size="sm" />
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-card max-md:gap-3 max-md:border-0 max-md:bg-transparent">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-3 max-md:border-0 max-md:p-0 md:px-4">
            <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:max-w-[280px] md:flex-none md:basis-[280px] md:rounded-[10px]">
              <Search className="size-4 shrink-0" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search wallets" aria-label="Search wallets" className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]" />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              ) : null}
            </label>
            <div className="hidden flex-1 md:block" />
            <span className="hidden text-xs text-text-3 md:inline">Updates every 15 s</span>
          </div>

          {shown.length === 0 ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <b className="text-sm">No wallet matches “{query}”</b>
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : (
            <>
              {/* Phone: one card per wallet. */}
              <div className="flex flex-col gap-3 md:hidden">
                {shown.map((wallet) => {
                  const today = wallet.todayRealizedPnlUsd ?? 0;
                  return (
                    <article key={wallet._id} className={cn("flex flex-col gap-3 rounded-[20px] border p-4", wallet.panic?.panic ? "border-destructive/40 bg-neg-soft" : "border-border bg-card")}>
                      <Link href={`/wallets/${wallet._id}`} className="flex items-center gap-3">
                        <WalletAvatar name={wallet.name} size="lg" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <b className={cn("truncate text-[15px] font-semibold", wallet.panic?.panic && "text-negative")}>{wallet.name}</b>
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-3">
                            {wallet.traderCount ?? 0} trader{wallet.traderCount === 1 ? "" : "s"}
                            {wallet.linkedLive ? <LinkedBadge /> : null}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <b className="font-semibold tabular-nums">{formatUsd(wallet.balanceUsd)}</b>
                          <span className={cn("text-xs tabular-nums", tone(wallet.realizedPnlUsd))}>{signedUsd(wallet.realizedPnlUsd)}</span>
                        </div>
                      </Link>
                      {wallet.panic && <PanicBar panic={wallet.panic} compact />}
                      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-text-3">
                        <span>
                          Today <b className={cn("font-semibold tabular-nums", tone(today))}>{today === 0 ? "$0.00" : signedUsd(today)}</b> · {wallet.openPositionCount + wallet.closedPositionCount} trades
                        </span>
                        <DuplicateWalletDialog source={wallet} onDuplicated={refresh} triggerClassName="h-9" />
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Desktop: the table. */}
              <div className="max-md:hidden">
                <Table className="min-w-[1000px]">
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <SortHead label="Wallet" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="left" className="pl-5" />
                      <TableHead className="w-[230px] text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Panic level</TableHead>
                      <SortHead label="Balance" sortKey="balance" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortHead label="Today's P&L" sortKey="today" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortHead label="Lifetime P&L" sortKey="lifetime" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortHead label="Traders" sortKey="traders" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <SortHead label="Trades" sortKey="trades" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                      <TableHead className="w-[170px] pr-5" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((wallet) => {
                      const today = wallet.todayRealizedPnlUsd ?? 0;
                      const panic = wallet.panic?.panic;
                      return (
                        <TableRow key={wallet._id} className={cn("h-[68px] border-border", panic && "bg-neg-soft hover:bg-neg-soft")}>
                          <TableCell className="pl-5">
                            <div className="flex min-w-0 items-center gap-3">
                              <WalletAvatar name={wallet.name} />
                              <div className="flex min-w-0 flex-col gap-1">
                                <Link href={`/wallets/${wallet._id}`} className={cn("truncate text-[13px] font-semibold hover:text-primary", panic && "text-negative")}>
                                  {wallet.name}
                                </Link>
                                {wallet.linkedLive ? <LinkedBadge /> : null}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{wallet.panic ? <PanicBar panic={wallet.panic} compact /> : <span className="text-xs text-text-3">No panic level set</span>}</TableCell>
                          <TableCell className="text-right text-[13px] tabular-nums">
                            <b className="font-semibold">{formatUsd(wallet.balanceUsd)}</b> <span className="text-xs text-text-3">/ {formatUsd(wallet.startingBalanceUsd)}</span>
                          </TableCell>
                          <TableCell className={cn("text-right text-[13px] tabular-nums", tone(today))}>{today === 0 ? "$0.00" : signedUsd(today)}</TableCell>
                          <TableCell className="text-right text-[13px] tabular-nums">
                            <b className={cn("font-semibold", tone(wallet.realizedPnlUsd))}>{signedUsd(wallet.realizedPnlUsd)}</b>
                          </TableCell>
                          <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{wallet.traderCount ?? 0}</TableCell>
                          <TableCell className="text-right text-[13px] text-text-3 tabular-nums">{wallet.openPositionCount + wallet.closedPositionCount}</TableCell>
                          <TableCell className="pr-5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <DuplicateWalletDialog source={wallet} onDuplicated={refresh} />
                              <Button variant="secondary" size="sm" asChild>
                                <Link href={`/wallets/${wallet._id}`}>Open</Link>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Phone: a floating create button above the tab bar. */}
      {wallets !== null && (
        <CreateWalletDialog
          onCreated={refresh}
          label="Create"
          size="lg"
          triggerClassName="fixed right-4 bottom-[84px] z-20 h-[52px] gap-2 rounded-full px-5 text-sm font-semibold shadow-[0_10px_28px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)] md:hidden"
        />
      )}
    </div>
  );
}
