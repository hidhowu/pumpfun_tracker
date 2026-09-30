"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addTradersToWallet, getWalletMembership, listWallets, removeTradersFromWallet } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { WalletView } from "@/lib/types";

/**
 * Per-trader "add to wallet" action, sibling to manage-lists-menu.tsx's
 * checkbox-toggle dropdown. No inline "create wallet" here (unlike lists) -
 * creating a wallet needs a starting $ balance, more than a quick inline
 * text field fits, so that flow lives on /wallets instead; this menu just
 * links there.
 */
export function ManageWalletsMenu({ traderAddress }: { traderAddress: string }) {
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletView[]>([]);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([listWallets(), getWalletMembership(traderAddress)])
      .then(([{ wallets }, { walletIds }]) => {
        setWallets(wallets);
        setMemberOf(new Set(walletIds));
      })
      .catch(() => toast.error("Failed to load wallets"))
      .finally(() => setLoading(false));
  }, [open, traderAddress]);

  async function toggle(wallet: WalletView, checked: boolean) {
    setPendingId(wallet._id);
    try {
      if (checked) {
        await addTradersToWallet(wallet._id, [traderAddress]);
        setMemberOf((prev) => new Set(prev).add(wallet._id));
      } else {
        await removeTradersFromWallet(wallet._id, [traderAddress]);
        setMemberOf((prev) => {
          const next = new Set(prev);
          next.delete(wallet._id);
          return next;
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update wallet assignment");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="size-7 p-0 text-muted-foreground hover:text-foreground" aria-label="Add to wallet">
          <WalletIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Add to wallet</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
        ) : wallets.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No wallets yet - create one first.</div>
        ) : (
          wallets.map((wallet) => (
            <DropdownMenuCheckboxItem
              key={wallet._id}
              checked={memberOf.has(wallet._id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) => toggle(wallet, checked)}
              className="justify-between"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{wallet.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">{formatUsd(wallet.balanceUsd)} available</span>
              </span>
              {pendingId === wallet._id && <Loader2 className="size-3 shrink-0 animate-spin" />}
            </DropdownMenuCheckboxItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onSelect={() => setOpen(false)} className="text-muted-foreground">
          <Link href="/wallets">Manage wallets…</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
