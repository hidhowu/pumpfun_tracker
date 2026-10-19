"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Coins, ShieldAlert, WalletCards } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateLiveWalletDialog } from "@/components/live-wallets/create-wallet-dialog";
import { AddressChip } from "@/components/live-wallets/shared";
import { listLiveWallets } from "@/lib/live-wallet-api";
import { formatSol, formatUsd } from "@/lib/format";
import type { LiveWalletListItem } from "@/lib/live-wallet-types";

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

  const totalUsd = wallets?.reduce((sum, w) => sum + (w.totalValueUsd ?? 0), 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <WalletCards className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Live Wallet</h1>
            <p className="text-sm text-muted-foreground">Real Solana wallets - balances, tokens and profit/loss read straight from the chain.</p>
          </div>
        </div>
        <CreateLiveWalletDialog onCreated={refresh} twoFactorEnabled={twoFactorEnabled} />
      </div>

      {!twoFactorEnabled ? (
        <div className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-negative" />
          <span>
            Two-factor sign-in is off for your account, so you can&apos;t create wallets or view private keys.{" "}
            <Link href="/account" className="font-medium underline underline-offset-2 hover:text-primary">
              Turn it on
            </Link>
          </span>
        </div>
      ) : null}

      {wallets && wallets.length > 1 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Coins className="size-4" />
          Total across {wallets.length} wallets: <span className="font-mono font-semibold text-foreground">{formatUsd(totalUsd)}</span>
        </div>
      ) : null}

      {loading && !wallets ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : !wallets || wallets.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
          <p className="text-sm text-muted-foreground">No live wallets yet - create one to start.</p>
        </div>
      ) : (
        <Card className="overflow-hidden border-border/60">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="pl-4">Wallet</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">SOL</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Total value</TableHead>
                  <TableHead className="pr-4"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((wallet) => (
                  <TableRow key={wallet._id} className="border-border/60">
                    <TableCell className="max-w-3xs pl-4 sm:max-w-xs">
                      <Link href={`/live-wallets/${wallet._id}`} className="group flex min-w-0 items-center gap-1 font-medium hover:text-primary">
                        <span className="truncate">{wallet.name}</span>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                      </Link>
                    </TableCell>
                    <TableCell>
                      <AddressChip value={wallet.address} label="wallet address" chars={5} />
                    </TableCell>
                    {wallet.error ? (
                      <TableCell colSpan={3} className="text-right text-xs text-muted-foreground">
                        Balance unavailable right now
                      </TableCell>
                    ) : (
                      <>
                        <TableCell className="text-right tabular-nums">{formatSol(wallet.solBalance)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">{wallet.tokenCount}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatUsd(wallet.totalValueUsd)}</TableCell>
                      </>
                    )}
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/live-wallets/${wallet._id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
