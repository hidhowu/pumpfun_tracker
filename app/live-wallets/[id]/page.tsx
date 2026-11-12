"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Eye, EyeOff, Info, KeyRound, Layers, LineChart, Pencil, RefreshCw, ScrollText, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityTable } from "@/components/live-wallets/activity-table";
import { HoldingsTable, SOL, TokenAccountsTable } from "@/components/live-wallets/holdings-table";
import { SolSheet } from "@/components/live-wallets/sol-sheet";
import { ReceiveDialog } from "@/components/live-wallets/receive-dialog";
import { SendDialog } from "@/components/live-wallets/send-dialog";
import { TokenSheet } from "@/components/live-wallets/token-sheet";
import { TradingPanel } from "@/components/live-wallets/trading-panel";
import { StuckSellsBanner } from "@/components/live-wallets/stuck-sells";
import { LiveModeStrip } from "@/components/live-wallets/live-mode-strip";
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

const TABS = [
  { value: "holdings", label: "Tokens", icon: Layers },
  { value: "activity", label: "Activity", icon: ScrollText },
  { value: "accounts", label: "Accounts", icon: Layers },
  { value: "trading", label: "Trading", icon: Zap },
  { value: "pnl", label: "P&L", icon: LineChart },
] as const;

/** A round action button with its label underneath - the phone layout's row of Receive / Send / Copy / Refresh / Key. */
function CircleAction({ label, icon: Icon, onClick, spinning, primary, ...rest }: { label: string; icon: typeof Copy; onClick?: () => void; spinning?: boolean; primary?: boolean } & React.ComponentProps<"button">) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-2 text-xs font-medium text-text-2 outline-none" {...rest}>
      <span
        className={cn(
          "flex size-[52px] items-center justify-center rounded-full border transition-colors group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
          primary ? "border-primary bg-primary text-primary-foreground group-hover:bg-primary/90" : "border-border bg-surface-2 text-foreground group-hover:border-line-2"
        )}
      >
        <Icon className={cn("size-5", spinning && "animate-spin")} />
      </span>
      {label}
    </button>
  );
}

function HeroStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-text-3">{label}</span>
      <b className={cn("text-[20px] leading-6 font-semibold tabular-nums", className)}>{value}</b>
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
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      {loading && !detail ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-12 w-72 rounded-xl" />
          <Skeleton className="h-40 w-full rounded-[20px]" />
          <Skeleton className="h-72 w-full rounded-[20px]" />
        </div>
      ) : error && !detail ? (
        <div className="flex flex-col items-start gap-3">
          <Link href="/live-wallets" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
            <ChevronLeft className="size-3.5" /> Wallets
          </Link>
          <div role="alert" className="w-full rounded-xl border border-destructive/30 bg-neg-soft p-5 text-sm text-[#ffc9d0]">
            {error}
          </div>
        </div>
      ) : wallet && detail ? (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-center gap-3 md:gap-3.5">
              <Button variant="outline" size="icon" asChild aria-label="Back to wallets" className="shrink-0 max-md:size-10">
                <Link href="/live-wallets">
                  <ChevronLeft />
                </Link>
              </Button>
              <WalletAvatar address={wallet.address} name={wallet.name} />
              <div className="flex min-w-0 flex-col gap-1">
                {editingName ? (
                  <Input
                    autoFocus
                    value={nameDraft}
                    maxLength={100}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => e.key === "Enter" && handleRename()}
                    className="h-9 w-full max-w-64 text-lg font-semibold"
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
                    <span className="truncate text-[20px] leading-7 font-semibold tracking-[-0.015em] md:text-[24px] md:leading-8">{wallet.name}</span>
                    <Pencil className="size-3.5 shrink-0 text-text-3 group-hover:text-primary" />
                  </button>
                )}
                <AddressChip value={wallet.address} label="wallet address" chars={4} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setMasked((v) => !v)} aria-label={masked ? "Show balances" : "Hide balances"} aria-pressed={masked} className="max-md:size-10">
                {masked ? <EyeOff /> : <Eye />}
              </Button>
              <div className="flex items-center gap-2 max-md:hidden">
                <Button variant="outline" className="gap-1.5" onClick={handleManualRefresh} disabled={refreshing}>
                  <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
                </Button>
                <ReceiveDialog name={wallet.name} address={wallet.address} />
                <SendDialog wallet={wallet} twoFactorEnabled={detail.twoFactorEnabled} solBalance={chain?.solBalance ?? null} onSent={handleManualRefresh} />
                <ViewKeyDialog wallet={wallet} twoFactorEnabled={detail.twoFactorEnabled} />
              </div>
            </div>
          </div>

          {detail.chainError ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-line-2 bg-card px-3.5 py-3 text-[13px] leading-5 text-text-2">
              <Info className="mt-0.5 size-4 shrink-0 text-text-3" />
              <span>Couldn&apos;t read this wallet from the chain right now ({detail.chainError}). Retrying automatically.</span>
            </div>
          ) : null}

          <StuckSellsBanner walletId={wallet._id} refreshKey={refreshKey} />
          <LiveModeStrip walletId={wallet._id} refreshKey={refreshKey} onChanged={handleManualRefresh} />

          <div className="flex flex-col gap-4 md:gap-6 xl:flex-row xl:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-4 md:gap-5">
              {/* Hero: total balance */}
              <section className="rounded-[20px] border border-volt-line bg-gradient-to-br from-volt-soft via-card to-card px-5 py-5 md:px-7 md:py-6">
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-sm text-text-2">Total balance</span>
                    <b className="truncate text-[40px] leading-[44px] font-semibold tracking-[-0.03em] tabular-nums md:text-[48px] md:leading-[52px]">{chain ? hide(formatUsd(chain.totalValueUsd)) : "—"}</b>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="text-sm text-text-2 tabular-nums">{chain ? hide(`≈ ${formatSol(chain.solBalance)}`) : "waiting for the chain"}</span>
                      {pnl ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-text-3">
                          <PnlPill usd={masked ? null : pnl.realizedPnlUsd} />
                          {masked ? HIDDEN : null} realized
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex gap-8 max-md:hidden">
                    <HeroStat label="SOL" value={chain ? hide(chain.solBalance.toFixed(3)) : "—"} />
                    <HeroStat label="Tokens" value={chain ? String(chain.tokens.length) : "—"} />
                    <HeroStat label="Unrealized" value={pnl ? hide(signedUsd(pnl.unrealizedPnlUsd)) : "—"} className={masked ? undefined : toneClass(pnl?.unrealizedPnlUsd)} />
                  </div>
                </div>
                {chain ? <span className="mt-3 block text-xs text-text-3">Updated {formatRelativeTime(chain.fetchedAt)}</span> : null}
              </section>

              {/* Phone actions */}
              <div className="grid grid-cols-5 gap-2 md:hidden">
                <ReceiveDialog name={wallet.name} address={wallet.address} trigger={<CircleAction label="Receive" icon={ArrowDown} primary />} />
                <SendDialog wallet={wallet} twoFactorEnabled={detail.twoFactorEnabled} solBalance={chain?.solBalance ?? null} onSent={handleManualRefresh} trigger={<CircleAction label="Send" icon={ArrowUp} />} />
                <CircleAction label="Copy" icon={Copy} onClick={() => handleCopyAddress(wallet.address)} />
                <CircleAction label="Refresh" icon={RefreshCw} onClick={handleManualRefresh} spinning={refreshing} disabled={refreshing} />
                <ViewKeyDialog wallet={wallet} twoFactorEnabled={detail.twoFactorEnabled} trigger={<CircleAction label="Key" icon={KeyRound} />} />
              </div>

              <Tabs defaultValue="holdings" className="flex flex-col gap-4 md:gap-5">
                {/* Wide screens: underlined tabs (P&L only below the width where the right rail is shown). */}
                <TabsList variant="line" className="hidden h-11 w-full justify-start gap-1 border-b border-border p-0 md:flex">
                  {TABS.map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      className={cn(
                        "h-11 flex-none gap-2 rounded-none px-3.5 text-sm font-medium after:inset-x-2.5 group-data-horizontal/tabs:after:bottom-0 data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:bg-primary",
                        t.value === "pnl" && "xl:hidden"
                      )}
                    >
                      <t.icon className="size-3.5" />
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {/* Phone: five equal buttons. */}
                <TabsList className="grid h-auto w-full grid-cols-5 md:hidden">
                  {TABS.map((t) => (
                    <TabsTrigger key={t.value} value={t.value} className="h-11 justify-center px-0 text-[13px]">
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="holdings">{chain ? <HoldingsTable chain={chain} onSelect={setSelectedMint} masked={masked} /> : <Skeleton className="h-48 w-full rounded-[20px]" />}</TabsContent>
                <TabsContent value="activity">
                  <ActivityTable walletId={wallet._id} onSelectToken={setSelectedMint} refreshKey={refreshKey} showSummary={false} />
                </TabsContent>
                <TabsContent value="accounts">
                  {chain ? <TokenAccountsTable walletId={wallet._id} accounts={chain.accounts} onSelect={setSelectedMint} onChanged={handleManualRefresh} /> : <Skeleton className="h-48 w-full rounded-[20px]" />}
                </TabsContent>
                <TabsContent value="trading">
                  <TradingPanel walletId={wallet._id} twoFactorEnabled={detail.twoFactorEnabled} refreshKey={refreshKey} funding={chain ? { solBalance: chain.solBalance, solUsd: chain.solUsd } : null} />
                </TabsContent>
                <TabsContent value="pnl" className="xl:hidden">
                  <div className="grid gap-4 md:grid-cols-2">
                    {pnl ? <PnlCard pnl={pnl} /> : null}
                    <PortfolioCard chain={chain} />
                  </div>
                </TabsContent>
              </Tabs>

              {detail.syncError ? <p className="text-xs text-text-3">Transaction sync: {detail.syncError}</p> : null}
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
