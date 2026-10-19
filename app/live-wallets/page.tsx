"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Plus, ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateLiveWalletDialog } from "@/components/live-wallets/create-wallet-dialog";
import { AddressChip, signedUsd, toneClass, WalletAvatar } from "@/components/live-wallets/shared";
import { listLiveWallets } from "@/lib/live-wallet-api";
import { formatSol, formatUsd } from "@/lib/format";
import type { LiveWalletListItem } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

function SummaryCard({ label, value, hint, valueClassName, className }: { label: string; value: string; hint: string; valueClassName?: string; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
        <span className={cn("truncate text-2xl font-extrabold tracking-tight tabular-nums", valueClassName)}>{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardContent>
    </Card>
  );
}

function WalletCard({ wallet }: { wallet: LiveWalletListItem }) {
  // The whole card is clickable through the name's stretched link; the address chip sits above it so its own links work.
  return (
    <div className="group relative flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-5 transition-colors focus-within:border-primary/60 hover:border-primary/50 hover:bg-accent/20">
      <div className="flex items-center gap-3.5">
        <WalletAvatar address={wallet.address} className="size-12" />
        <div className="min-w-0 flex-1">
          <Link href={`/live-wallets/${wallet._id}`} className="block truncate text-[17px] font-extrabold outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']">
            {wallet.name}
          </Link>
          <div className="relative z-10 mt-0.5 w-fit">
            <AddressChip value={wallet.address} label="wallet address" chars={5} />
          </div>
        </div>
        <ChevronRight className="size-[18px] shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground">Total value</div>
        {wallet.error ? (
          <div className="mt-1 text-sm text-muted-foreground">Balance unavailable right now</div>
        ) : (
          <div className="mt-0.5 text-3xl font-extrabold tracking-tight tabular-nums">{formatUsd(wallet.totalValueUsd)}</div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4 text-[13px] text-muted-foreground">
        <span className="min-w-0 truncate tabular-nums">{wallet.error ? "-" : `${formatSol(wallet.solBalance)} · ${wallet.tokenCount} token${wallet.tokenCount === 1 ? "" : "s"}`}</span>
        <span className={cn("shrink-0 font-bold tabular-nums", toneClass(wallet.realizedPnlUsd))}>{wallet.sells ? signedUsd(wallet.realizedPnlUsd) : "No sells yet"}</span>
      </div>
    </div>
  );
}

export default function LiveWalletsPage() {
  const [wallets, setWallets] = useState<LiveWalletListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { wallets, twoFactorEnabled } = await listLiveWallets();
      setWallets(wallets);
      setTwoFactorEnabled(twoFactorEnabled);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load wallets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const list = wallets ?? [];
  const totalUsd = list.reduce((sum, w) => sum + (w.totalValueUsd ?? 0), 0);
  const totalSol = list.reduce((sum, w) => sum + (w.solBalance ?? 0), 0);
  const realized = list.reduce((sum, w) => sum + w.realizedPnlUsd, 0);
  const wins = list.reduce((sum, w) => sum + w.wins, 0);
  const losses = list.reduce((sum, w) => sum + w.losses, 0);
  const sells = list.reduce((sum, w) => sum + w.sells, 0);
  const decided = wins + losses;
  const tokens = list.reduce((sum, w) => sum + (w.tokenCount ?? 0), 0);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Live Wallet</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">Real Solana wallets. Balances, tokens and profit and loss come straight from the chain.</p>
        </div>
        <div className="hidden sm:block">
          <CreateLiveWalletDialog onCreated={refresh} twoFactorEnabled={twoFactorEnabled} />
        </div>
      </div>

      {!twoFactorEnabled ? (
        <div className="flex items-start gap-3 rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3.5 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-negative" />
          <span>
            Two-factor sign-in is off for your account, so you can&apos;t create wallets or view private keys.{" "}
            <Link href="/account" className="font-bold underline underline-offset-2 hover:text-brand-soft">
              Turn it on
            </Link>
          </span>
        </div>
      ) : null}

      {loading && !wallets ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : list.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-[#8b7cff] to-[#35d6b0] text-white">
            <ShieldCheck className="size-7" />
          </div>
          <div>
            <div className="text-lg font-extrabold">No wallets yet</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Create a wallet to get a Solana address you can send funds to. Its private key is yours to save, and stays encrypted here.</p>
          </div>
          <CreateLiveWalletDialog onCreated={refresh} twoFactorEnabled={twoFactorEnabled} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-[1.6fr_repeat(3,minmax(0,1fr))]">
            <Card className="border-[#38307f] bg-linear-to-br from-[#2b2370] via-card to-card col-span-full xl:col-span-1">
              <CardContent className="flex flex-col gap-1">
                <span className="text-[13px] font-semibold text-[#c9c2ff]">
                  Total across {list.length} wallet{list.length === 1 ? "" : "s"}
                </span>
                <span className="text-4xl font-extrabold tracking-tight tabular-nums">{formatUsd(totalUsd)}</span>
                <span className="text-[13px] text-[#c9c2ff]">
                  {formatSol(totalSol)} + {tokens} token{tokens === 1 ? "" : "s"}
                </span>
              </CardContent>
            </Card>
            <SummaryCard label="Realized profit and loss" value={signedUsd(realized)} hint={`${sells} sell${sells === 1 ? "" : "s"} across all wallets`} valueClassName={toneClass(realized)} />
            <SummaryCard label="Win rate" value={decided ? `${Math.round((wins / decided) * 100)}%` : "-"} hint={decided ? `${wins} won, ${losses} lost` : "no closed trades yet"} />
            <SummaryCard className="max-sm:hidden" label="Wallets" value={String(list.length)} hint={`${tokens} token${tokens === 1 ? "" : "s"} held in total`} />
          </div>

          <div className="text-[17px] font-extrabold">Your wallets</div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((wallet) => (
              <WalletCard key={wallet._id} wallet={wallet} />
            ))}
            <div className="sm:hidden">
              <CreateLiveWalletDialog
                onCreated={refresh}
                twoFactorEnabled={twoFactorEnabled}
                trigger={
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-input text-base font-bold text-brand-soft transition-colors hover:bg-accent/30"
                  >
                    <Plus className="size-5" /> Create new wallet
                  </button>
                }
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
