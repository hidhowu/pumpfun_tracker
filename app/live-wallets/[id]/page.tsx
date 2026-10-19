"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Coins, History, Landmark, Layers, LineChart, RefreshCw, Scale, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatTile } from "@/components/traders/stat-tile";
import { ActivityTable } from "@/components/live-wallets/activity-table";
import { HoldingsTable, TokenAccountsTable } from "@/components/live-wallets/holdings-table";
import { TokenSheet } from "@/components/live-wallets/token-sheet";
import { ViewKeyDialog } from "@/components/live-wallets/view-key-dialog";
import { AddressChip, signedUsd, toneOf } from "@/components/live-wallets/shared";
import { getLiveWallet, renameLiveWallet } from "@/lib/live-wallet-api";
import { formatRelativeTime, formatSol, formatUsd } from "@/lib/format";
import type { LiveWalletDetail } from "@/lib/live-wallet-types";

const POLL_INTERVAL_MS = 15_000;

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

  const wallet = detail?.wallet;
  const chain = detail?.chain;
  const selectedHolding = chain?.tokens.find((t) => t.mint === selectedMint) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit text-muted-foreground">
        <Link href="/live-wallets">
          <ArrowLeft className="size-4" /> Back to live wallets
        </Link>
      </Button>

      {loading && !detail ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : error && !detail ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{error}</div>
      ) : wallet && detail ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <WalletCards className="size-4.5" />
              </div>
              <div className="flex flex-col">
                {editingName ? (
                  <Input
                    autoFocus
                    value={nameDraft}
                    maxLength={100}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => e.key === "Enter" && handleRename()}
                    className="h-8 w-56"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setNameDraft(wallet.name);
                      setEditingName(true);
                    }}
                    className="text-left text-lg font-semibold tracking-tight hover:text-primary"
                  >
                    {wallet.name}
                  </button>
                )}
                <AddressChip value={wallet.address} label="wallet address" chars={6} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ViewKeyDialog wallet={wallet} twoFactorEnabled={detail.twoFactorEnabled} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleManualRefresh} disabled={refreshing}>
                <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>

          {detail.chainError ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Couldn&apos;t read this wallet from the chain right now ({detail.chainError}). Retrying automatically.
            </div>
          ) : null}

          {/* Dashboard header: total value up top, then the breakdown */}
          <Card className="border-border/70 bg-card/60">
            <CardContent className="flex flex-col gap-1 px-6 py-5">
              <span className="text-xs font-medium text-muted-foreground">Total wallet value</span>
              <span className="font-mono text-4xl font-semibold tracking-tight">{chain ? formatUsd(chain.totalValueUsd) : "-"}</span>
              <span className="text-xs text-muted-foreground">
                {chain ? `${formatSol(chain.solBalance)} + ${chain.tokens.length} token${chain.tokens.length === 1 ? "" : "s"} · updated ${formatRelativeTime(chain.fetchedAt)}` : "waiting for the chain"}
              </span>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="SOL balance" value={chain ? formatSol(chain.solBalance) : "-"} icon={Coins} hint={chain ? formatUsd(chain.solValueUsd) : undefined} />
            <StatTile label="Tokens value" value={chain ? formatUsd(chain.tokensValueUsd) : "-"} icon={Layers} hint={chain ? `${chain.tokens.length} held · ${chain.accounts.length} accounts` : undefined} />
            <StatTile label="Unrealized P&L" value={signedUsd(detail.pnl.unrealizedPnlUsd)} icon={LineChart} tone={toneOf(detail.pnl.unrealizedPnlUsd)} hint="open positions vs. cost" />
            <StatTile
              label="Realized P&L"
              value={signedUsd(detail.pnl.realizedPnlUsd)}
              icon={Scale}
              tone={toneOf(detail.pnl.realizedPnlUsd)}
              hint={`${detail.pnl.wins} won · ${detail.pnl.losses} lost`}
            />
          </div>

          <Tabs defaultValue="holdings" className="flex flex-col gap-4">
            <TabsList>
              <TabsTrigger value="holdings" className="gap-1.5">
                <Landmark className="size-3.5" /> Holdings
              </TabsTrigger>
              <TabsTrigger value="accounts" className="gap-1.5">
                <Layers className="size-3.5" /> Token accounts
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5">
                <History className="size-3.5" /> Transactions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="holdings">{chain ? <HoldingsTable chain={chain} onSelect={setSelectedMint} /> : <Skeleton className="h-40 w-full rounded-xl" />}</TabsContent>
            <TabsContent value="accounts">{chain ? <TokenAccountsTable accounts={chain.accounts} onSelect={setSelectedMint} /> : <Skeleton className="h-40 w-full rounded-xl" />}</TabsContent>
            <TabsContent value="activity">
              <ActivityTable walletId={wallet._id} onSelectToken={setSelectedMint} refreshKey={refreshKey} />
            </TabsContent>
          </Tabs>

          {detail.syncError ? <p className="text-xs text-muted-foreground">Transaction sync: {detail.syncError}</p> : null}

          <TokenSheet walletId={wallet._id} mint={selectedMint} holding={selectedHolding} onClose={() => setSelectedMint(null)} />
        </>
      ) : null}
    </div>
  );
}
