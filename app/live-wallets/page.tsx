"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronRight, Plus, ShieldOff, TriangleAlert, WalletCards, Zap } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateLiveWalletDialog } from "@/components/live-wallets/create-wallet-dialog";
import { AddressChip, signedUsd, toneClass, WalletAvatar } from "@/components/live-wallets/shared";
import { listLiveWallets } from "@/lib/live-wallet-api";
import { formatSol, formatUsd } from "@/lib/format";
import type { LiveWalletListItem } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

function Tile({ label, value, hint, valueClassName, className }: { label: string; value: string; hint: string; valueClassName?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3.5 md:px-5 md:py-4", className)}>
      <span className="text-xs text-text-3">{label}</span>
      <b className={cn("truncate text-[24px] leading-8 font-semibold tracking-[-0.02em] tabular-nums md:text-[28px] md:leading-9", valueClassName)}>{value}</b>
      <span className="truncate text-xs text-text-3">{hint}</span>
    </div>
  );
}

function WalletCard({ wallet }: { wallet: LiveWalletListItem }) {
  // The whole card is clickable through the name's stretched link; the address chip sits above it so its own links work.
  return (
    <article className="group relative flex min-w-0 flex-col gap-4 rounded-[20px] border border-border bg-card p-4 transition-colors focus-within:border-volt-line hover:border-line-2 md:gap-5 md:p-5">
      <div className="flex items-center gap-3.5">
        <WalletAvatar address={wallet.address} name={wallet.name} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link href={`/live-wallets/${wallet._id}`} className="block truncate text-[16px] leading-5 font-semibold outline-none after:absolute after:inset-0 after:rounded-[20px] after:content-['']">
            {wallet.name}
          </Link>
          <div className="relative z-10 w-fit">
            <AddressChip value={wallet.address} label="wallet address" chars={4} />
          </div>
        </div>
        <ChevronRight className="size-[18px] shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5" />
      </div>

      {wallet.stuckSells > 0 ? (
        <div role="alert" className="relative z-10 flex items-center gap-2 rounded-xl border border-destructive/30 bg-neg-soft px-3 py-2.5 text-[13px] font-semibold text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          {wallet.stuckSells === 1 ? "A sell failed — position still held" : `${wallet.stuckSells} sells failed — positions still held`}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-3">Total value</span>
        {wallet.error ? (
          <span className="text-sm text-text-2">Balance unavailable right now</span>
        ) : (
          <b className="text-[28px] leading-9 font-semibold tracking-[-0.025em] tabular-nums">{formatUsd(wallet.totalValueUsd)}</b>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5 text-[13px]">
        <span className="min-w-0 truncate text-text-2 tabular-nums">{wallet.error ? "—" : `${formatSol(wallet.solBalance)} · ${wallet.tokenCount} token${wallet.tokenCount === 1 ? "" : "s"}`}</span>
        <b className={cn("shrink-0 font-semibold tabular-nums", wallet.sells ? toneClass(wallet.realizedPnlUsd) : "font-normal text-text-3")}>{wallet.sells ? signedUsd(wallet.realizedPnlUsd) : "No sells yet"}</b>
      </div>
    </article>
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

  const realFunds = (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-warn/30 bg-warn-soft px-2 text-[11.5px] font-medium text-warn">
      <Zap className="size-3" /> Real funds
    </span>
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px] md:tracking-[-0.025em]">
            Live wallet
            <HelpTip>Real Solana wallets. Balances, tokens and P&amp;L come straight from the chain.</HelpTip>
          </h1>
          {realFunds}
        </div>
        <div className="max-md:hidden">
          <CreateLiveWalletDialog onCreated={refresh} twoFactorEnabled={twoFactorEnabled} />
        </div>
      </div>

      {!twoFactorEnabled ? (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-neg-soft px-3.5 py-3 text-[13px] leading-5 text-[#ffc9d0]">
          <ShieldOff className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0">
            Two-factor sign-in is off for your account, so you can&apos;t create wallets or view private keys.{" "}
            <Link href="/account" className="font-semibold text-foreground underline underline-offset-2">
              Turn it on
            </Link>
          </span>
        </div>
      ) : null}

      {loading && !wallets ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 w-full rounded-[20px]" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-[20px]" />
            ))}
          </div>
        </div>
      ) : list.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center gap-3.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <WalletCards className="size-6" />
          </span>
          <b className="text-[15px] font-semibold">No wallets yet</b>
          <p className="max-w-[420px] text-sm text-text-2">Create one to get a Solana address you can fund. Its private key is yours to save and stays encrypted here.</p>
          <CreateLiveWalletDialog onCreated={refresh} twoFactorEnabled={twoFactorEnabled} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-[1.6fr_repeat(3,minmax(0,1fr))]">
            <div className="col-span-full flex min-w-0 flex-col gap-1 rounded-[20px] border border-volt-line bg-gradient-to-br from-volt-soft via-card to-card px-5 py-4 md:py-5 xl:col-span-1">
              <span className="text-sm text-text-2">
                Total across {list.length} wallet{list.length === 1 ? "" : "s"}
              </span>
              <b className="truncate text-[34px] leading-10 font-semibold tracking-[-0.03em] tabular-nums md:text-[44px] md:leading-[48px]">{formatUsd(totalUsd)}</b>
              <span className="text-[13px] text-text-2 tabular-nums">
                {formatSol(totalSol)} + {tokens} token{tokens === 1 ? "" : "s"}
              </span>
            </div>
            <Tile label="Realized P&L" value={signedUsd(realized)} hint={`${sells} sell${sells === 1 ? "" : "s"} across all wallets`} valueClassName={toneClass(realized)} />
            <Tile label="Win rate" value={decided ? `${Math.round((wins / decided) * 100)}%` : "—"} hint={decided ? `${wins} won, ${losses} lost` : "no closed trades yet"} />
            <Tile className="max-md:hidden" label="Wallets" value={String(list.length)} hint={`${tokens} token${tokens === 1 ? "" : "s"} held in total`} />
          </div>

          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[17px] leading-6 font-semibold">Your wallets</h2>
            <span className="text-xs text-text-3">Refreshes every 20 s</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
            {list.map((wallet) => (
              <WalletCard key={wallet._id} wallet={wallet} />
            ))}
            <div className="md:hidden">
              <CreateLiveWalletDialog
                onCreated={refresh}
                twoFactorEnabled={twoFactorEnabled}
                trigger={
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-line-3 text-[15px] font-semibold text-primary transition-colors hover:bg-volt-soft"
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
