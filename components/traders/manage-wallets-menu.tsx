"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, Loader2, Wallet as WalletIcon } from "lucide-react";
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
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { CheckMark, DialogHead } from "@/components/ui/dialog-parts";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import { addTradersToWallet, getWalletMembership, listWallets, removeTradersFromWallet } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { WalletView } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Per-trader "add to wallet" action, sibling to manage-lists-menu.tsx: a checkbox-toggle dropdown on a desktop, a bottom sheet on a phone.
 * No inline "create wallet" here (unlike lists) - creating a wallet needs a starting $ balance, more than a quick inline text field fits,
 * so that flow lives on /wallets instead; this menu just links there.
 */
export function ManageWalletsMenu({ traderAddress, triggerClassName, label, disabled }: { traderAddress: string; triggerClassName?: string; /** Shows a labelled outline button instead of the small icon. */ label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletView[]>([]);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const phone = !useMediaQuery("(min-width: 768px)");

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
        const result = await addTradersToWallet(wallet._id, [traderAddress]);
        if (result.blacklisted.length) {
          toast.warning("This trader is blacklisted - it can't be added to a wallet");
          return;
        }
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

  const trigger = label ? (
    <Button variant="outline" size="lg" disabled={disabled} className={triggerClassName} aria-label="Add to wallet" onClick={phone ? () => setOpen(true) : undefined}>
      <WalletIcon />
      {label}
      <ChevronDown className="size-3.5 text-text-3" />
    </Button>
  ) : (
    <Button variant="ghost" size="sm" disabled={disabled} className={cn("size-7 p-0 text-text-2 hover:text-foreground", triggerClassName)} aria-label="Add to wallet" onClick={phone ? () => setOpen(true) : undefined}>
      <WalletIcon className="size-3.5" />
    </Button>
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHead icon={<WalletIcon className="size-5" />} title="Add to wallet" description="Tick the sim wallets that should copy this trader." />
            <div className="flex flex-col">
              {loading && wallets.length === 0 ? (
                <Skeleton className="h-[60px] w-full rounded-[10px]" />
              ) : wallets.length === 0 ? (
                <p className="py-3 text-sm text-text-3">No wallets yet - create one first.</p>
              ) : (
                wallets.map((wallet) => {
                  const checked = memberOf.has(wallet._id);
                  return (
                    <button
                      key={wallet._id}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      disabled={pendingId === wallet._id}
                      onClick={() => toggle(wallet, !checked)}
                      className="flex min-h-[60px] items-center gap-3 border-b border-border text-left last:border-b-0"
                    >
                      <CheckMark checked={checked} className="size-[22px]" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px]">{wallet.name}</span>
                        <span className="text-xs text-text-3">{formatUsd(wallet.balanceUsd)} available</span>
                      </span>
                      {pendingId === wallet._id ? <Loader2 className="size-4 shrink-0 animate-spin text-text-3" /> : null}
                    </button>
                  );
                })
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="lg" asChild className="flex-1">
                <Link href="/wallets" onClick={() => setOpen(false)}>
                  Manage wallets…
                </Link>
              </Button>
              <Button size="lg" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Add to wallet</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="px-2 py-1.5 text-xs text-text-3">Loading…</div>
        ) : wallets.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-text-3">No wallets yet - create one first.</div>
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
                <span className="truncate text-[11px] text-text-3">{formatUsd(wallet.balanceUsd)} available</span>
              </span>
              {pendingId === wallet._id && <Loader2 className="size-3 shrink-0 animate-spin" />}
            </DropdownMenuCheckboxItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onSelect={() => setOpen(false)} className="text-text-2">
          <Link href="/wallets">Manage wallets…</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
