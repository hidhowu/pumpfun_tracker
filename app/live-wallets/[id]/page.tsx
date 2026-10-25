"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ChevronLeft, Copy, Eye, EyeOff, KeyRound, Pencil, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTable } from "@/components/live-wallets/activity-table";
import { HoldingsTable, SOL, TokenAccountsTable } from "@/components/live-wallets/holdings-table";
import { SolSheet } from "@/components/live-wallets/sol-sheet";
import { ReceiveDialog } from "@/components/live-wallets/receive-dialog";
import { TokenSheet } from "@/components/live-wallets/token-sheet";
import { TradingPanel } from "@/components/live-wallets/trading-panel";
import { StuckSellsBanner } from "@/components/live-wallets/stuck-sells";
import { ViewKeyDialog } from "@/components/live-wallets/view-key-dialog";
import { PnlCard, PortfolioCard, SecurityNote } from "@/components/live-wallets/wallet-panels";
import { AddressChip, PnlPill, signedUsd, toneClass, WalletAvatar } from "@/components/live-wallets/shared";
import { getLiveWallet, renameLiveWallet } from "@/lib/live-wallet-api";
import { copyText } from "@/lib/clipboard";
import { formatRelativeTime, formatSol, formatUsd } from "@/lib/format";
import type { LiveWalletDetail } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;
const HIDDEN = "••••";

/** A round action button with its label underneath - the phone layout's row of Receive / Copy / Refresh / Key. */
function CircleAction({ label, icon: Icon, onClick, spinning, primary, ...rest }: { label: string; icon: typeof Copy; onClick?: () => void; spinning?: boolean; primary?: boolean } & React.ComponentProps<"button">) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-2 text-[13px] font-bold outline-none" {...rest}>
      <span
        className={cn(
          "flex size-14 items-center justify-center rounded-full border transition-colors group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
          primary ? "border-primary bg-primary text-primary-foreground group-hover:bg-primary/90" : "border-border bg-secondary text-foreground group-hover:bg-accent"
        )}
      >
        <Icon className={cn("size-[22px]", spinning && "animate-spin")} />
      </span>
      {label}
    </button>
  );
}

function HeroStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-[#c9c2ff]">{label}</div>
      <div className={cn("mt-1 text-xl font-extrabold tabular-nums", className)}>{value}</div>
    </div>
  );
}

export default function LiveWalletDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<LiveWalletDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [masked, setMasked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setDetail(await getLiveWallet(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallet");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleRename() {
    const trimmed = nameDraft.trim();
    const current = detail?.wallet;
    setEditingName(false);
    if (!trimmed || !current || trimmed === current.name) return;
    try {
      const { wallet } = await renameLiveWallet(id, trimmed);
      setDetail((d) => (d ? { ...d, wallet: { ...d.wallet, name: wallet.name } } : d));
      toast.success("Wallet renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename wallet");
    }
  }

  function handleManualRefresh() {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    refresh();
  }

  async function handleCopyAddress(address: string) {
    if (await copyText(address)) toast.success("Address copied");
    else toast.error("Couldn't copy the address - select it and press Ctrl+C");
  }

  const wallet = detail?.wallet;
  const chain = detail?.chain;
  const pnl = detail?.pnl;
  const selectedHolding = chain?.tokens.find((t) => t.mint === selectedMint) ?? null;
  const solOpen = selectedMint === SOL;
  const hide = (text: string) => (masked ? HIDDEN : text);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {loading && !detail ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-12 w-72 rounded-xl" />
          <Skeleton className="h-40 w-full rounded-3xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      ) : error && !detail ? (
        <div className="flex flex-col items-start gap-3">
          <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
            <Link href="/live-wallets">
              <ChevronLeft className="size-4" /> Wallets
            </Link>
          </Button>
          <div className="w-full rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{error}</div>
        </div>
      ) : wallet && detail ? (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
              <Button variant="outline" size="icon" asChild aria-label="Back to wallets" className="shrink-0">
                <Link href="/live-wallets">
                  <ChevronLeft className="size-5" />
                </Link>
              </Button>
              <WalletAvatar address={wallet.address} className="size-11" />
              <div className="min-w-0">
                {editingName ? (
                  <Input
                    autoFocus
                    value={nameDraft}
                    maxLength={100}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => e.key === "Enter" && handleRename()}
                    className="h-9 w-full max-w-64 text-lg font-bold"
                    aria-label="Wallet name"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(wallet.name);
                      setEditingName(true);
                    }}
                    className="group flex max-w-full items-center gap-2 text-left"
                    aria-label="Rename wallet"
                  >
                    <span className="truncate text-xl font-extrabold tracking-tight sm:text-2xl">{wallet.name}</span>
                    <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </button>
                )}
                <AddressChip value={wallet.address} label="wallet address" chars={5} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setMasked((v) => !v)} aria-label={masked ? "Show balances" : "Hide balances"} aria-pressed={masked}>
                {masked ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
              <div className="hidden items-center gap-2 md:flex">
                <Button variant="outline" className="gap-2" onClick={handleManualRefresh} disabled={refreshing}>
                  <RefreshCw className={cn("size-4", refreshing && "animate-spin")} /> Refresh
                </Button>
                <ReceiveDialog name={wallet.name} address={wallet.address} />
                <ViewKeyDialog wallet={wallet} twoFactorEnabled={detail.twoFactorEnabled} />
              </div>
            </div>
          </div>

          {detail.chainError ? (
            <div className="rounded-2xl border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
              Couldn&apos;t read this wallet from the chain right now ({detail.chainError}). Retrying automatically.
            </div>
          ) : null}

          <StuckSellsBanner walletId={wallet._id} refreshKey={refreshKey} />

          <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-6">
              {/* Hero: total balance */}
              <Card className="border-[#38307f] bg-linear-to-br from-[#221c5e] via-card to-card">
                <div className="flex flex-col items-center gap-6 px-5 py-2 text-center sm:flex-row sm:justify-between sm:px-7 sm:text-left">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#c9c2ff]">Total balance</div>
                    <div className="mt-1 text-5xl font-extrabold tracking-tight tabular-nums sm:text-[44px] lg:text-5xl">{chain ? hide(formatUsd(chain.totalValueUsd)) : "-"}</div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:justify-start">
                      <span className="text-sm text-[#c9c2ff] tabular-nums">{chain ? hide(`≈ ${formatSol(chain.solBalance)}`) : "waiting for the chain"}</span>
                      {pnl ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
                          <PnlPill usd={masked ? null : pnl.realizedPnlUsd} />
                          {masked ? HIDDEN : null} realized
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="hidden gap-8 sm:flex">
                    <HeroStat label="SOL" value={chain ? hide(chain.solBalance.toFixed(3)) : "-"} />
                    <HeroStat label="Tokens" value={chain ? String(chain.tokens.length) : "-"} />
                    <HeroStat label="Unrealized" value={pnl ? hide(signedUsd(pnl.unrealizedPnlUsd)) : "-"} className={masked ? undefined : toneClass(pnl?.unrealizedPnlUsd)} />
                  </div>
                </div>
                {chain ? <div className="px-5 text-center text-xs text-[#c9c2ff]/70 sm:px-7 sm:text-left">Updated {formatRelativeTime(chain.fetchedAt)}</div> : null}
              </Card>

              {/* Phone actions */}
              <div className="grid grid-cols-4 gap-2 md:hidden">
                <ReceiveDialog name={wallet.name} address={wallet.address} trigger={<CircleAction label="Receive" icon={ArrowDown} primary />} />
                <CircleAction label="Copy" icon={Copy} onClick={() => handleCopyAddress(wallet.address)} />
                <CircleAction label="Refresh" icon={RefreshCw} onClick={handleManualRefresh} spinning={refreshing} disabled={refreshing} />
                <ViewKeyDialog wallet={wallet} twoFactorEnabled={detail.twoFactorEnabled} trigger={<CircleAction label="Key" icon={KeyRound} />} />
              </div>

              <Tabs defaultValue="holdings" className="gap-4">
                <TabsList className="w-full sm:w-fit">
                  <TabsTrigger value="holdings">Tokens</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                  <TabsTrigger value="accounts">Accounts</TabsTrigger>
                  <TabsTrigger value="trading">Trading</TabsTrigger>
                  <TabsTrigger value="pnl" className="xl:hidden">
                    <TrendingUp className="size-4 max-sm:hidden" /> P&amp;L
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="holdings">{chain ? <HoldingsTable chain={chain} onSelect={setSelectedMint} masked={masked} /> : <Skeleton className="h-48 w-full rounded-2xl" />}</TabsContent>
                <TabsContent value="activity">
                  <ActivityTable walletId={wallet._id} onSelectToken={setSelectedMint} refreshKey={refreshKey} showSummary={false} />
                </TabsContent>
                <TabsContent value="accounts">{chain ? <TokenAccountsTable walletId={wallet._id} accounts={chain.accounts} onSelect={setSelectedMint} onChanged={handleManualRefresh} /> : <Skeleton className="h-48 w-full rounded-2xl" />}</TabsContent>
                <TabsContent value="trading">
                  <TradingPanel walletId={wallet._id} twoFactorEnabled={detail.twoFactorEnabled} refreshKey={refreshKey} />
                </TabsContent>
                <TabsContent value="pnl" className="xl:hidden">
                  <div className="grid gap-4 md:grid-cols-2">
                    {pnl ? <PnlCard pnl={pnl} /> : null}
                    <PortfolioCard chain={chain} />
                  </div>
                </TabsContent>
              </Tabs>

              {detail.syncError ? <p className="text-xs text-muted-foreground">Transaction sync: {detail.syncError}</p> : null}
            </div>

            {/* Right rail, wide screens only (below that the same panels live in the P&L tab) */}
            <aside className="hidden w-[300px] shrink-0 flex-col gap-4 xl:flex">
              <PortfolioCard chain={chain} />
              {pnl ? <PnlCard pnl={pnl} /> : null}
              <SecurityNote />
            </aside>
          </div>

          <TokenSheet
            walletId={wallet._id}
            mint={solOpen ? null : selectedMint}
            holding={selectedHolding}
            accounts={chain?.accounts.filter((a) => a.mint === selectedMint) ?? []}
            onClose={() => setSelectedMint(null)}
            onChanged={handleManualRefresh}
          />
          <SolSheet walletId={wallet._id} open={solOpen} chain={chain} onClose={() => setSelectedMint(null)} />
        </>
      ) : null}
    </div>
  );
}
