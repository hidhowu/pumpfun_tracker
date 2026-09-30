"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUpRight, Coins, Loader2, Plus, Users, Wallet as WalletIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createWallet, listWallets } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { WalletView } from "@/lib/types";
import { cn } from "@/lib/utils";

function CreateWalletDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startingBalanceUsd, setStartingBalanceUsd] = useState("100");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmed = name.trim();
    const balance = Number(startingBalanceUsd);
    if (!trimmed) {
      toast.error("Enter a wallet name");
      return;
    }
    if (!Number.isFinite(balance) || balance <= 0) {
      toast.error("Enter a positive starting balance");
      return;
    }
    setSubmitting(true);
    try {
      await createWallet(trimmed, balance);
      toast.success(`Wallet "${trimmed}" created`);
      setName("");
      setStartingBalanceUsd("100");
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Create wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a wallet</DialogTitle>
          <DialogDescription>
            A second, fully independent simulation - assign a group of traders to it and every one of their real
            trades mirrors against this wallet&apos;s own fixed balance and settings, starting from zero.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="wallet-name">Name</Label>
            <Input id="wallet-name" placeholder="e.g. High conviction picks" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wallet-balance">Starting balance</Label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
              <Input
                id="wallet-balance"
                type="number"
                min={1}
                step={10}
                value={startingBalanceUsd}
                onChange={(e) => setStartingBalanceUsd(e.target.value)}
                className="pl-7"
              />
            </div>
            <p className="text-xs text-muted-foreground">Fixed - this wallet can never go negative; a trade it can&apos;t afford is skipped.</p>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletView[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { wallets } = await listWallets();
      setWallets(wallets);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load wallets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <WalletIcon className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Wallets</h1>
            <p className="text-sm text-muted-foreground">
              A second, independent copy-trade simulation per wallet - fixed balance, own settings, never goes negative.
            </p>
          </div>
        </div>
        <CreateWalletDialog onCreated={refresh} />
      </div>

      {loading && !wallets ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : !wallets || wallets.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
          <p className="text-sm text-muted-foreground">No wallets yet - create one to start.</p>
        </div>
      ) : (
        <Card className="overflow-hidden border-border/60">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="pl-4">Wallet</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="text-right">Lifetime P&amp;L</TableHead>
                  <TableHead className="text-right">Traders</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="pr-4"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wallets.map((wallet) => {
                  const positive = wallet.realizedPnlUsd > 0;
                  const negative = wallet.realizedPnlUsd < 0;
                  return (
                    <TableRow key={wallet._id} className="border-border/60">
                      <TableCell className="max-w-3xs pl-4 sm:max-w-xs">
                        <Link
                          href={`/wallets/${wallet._id}`}
                          className="group flex min-w-0 items-center gap-1 font-medium hover:text-primary"
                        >
                          <span className="truncate">{wallet.name}</span>
                          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUsd(wallet.balanceUsd)}
                        <span className="ml-1 text-xs text-muted-foreground">/ {formatUsd(wallet.startingBalanceUsd)}</span>
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", positive && "text-positive", negative && "text-negative")}>
                        <span className="inline-flex items-center justify-end gap-1">
                          <Coins className="size-3.5 opacity-70" />
                          {formatUsd(wallet.realizedPnlUsd)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="inline-flex items-center justify-end gap-1 text-muted-foreground">
                          <Users className="size-3.5" />
                          {wallet.traderCount ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {wallet.openPositionCount + wallet.closedPositionCount}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/wallets/${wallet._id}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
