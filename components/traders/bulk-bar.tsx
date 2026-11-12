"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Loader2, Tag, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { addTradersToList, addTradersToWallet, listTraderLists, listWallets } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { TraderListView, WalletView } from "@/lib/types";

/**
 * The strip that appears above the table when rows are selected: add them all to a list, assign them all to a sim wallet,
 * or blacklist them (the confirmation lives in the table). Lists/wallets are fetched when their menu opens.
 */
export function BulkBar({
  addresses,
  onClear,
  onListsChanged,
  onBlacklist,
}: {
  addresses: string[];
  onClear: () => void;
  onListsChanged?: () => void;
  /** Omitted on pages where blacklisting isn't offered. */
  onBlacklist?: () => void;
}) {
  const [lists, setLists] = useState<TraderListView[] | null>(null);
  const [wallets, setWallets] = useState<WalletView[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadLists(open: boolean) {
    if (!open) return;
    try {
      setLists((await listTraderLists()).lists);
    } catch {
      toast.error("Failed to load lists");
    }
  }
  async function loadWallets(open: boolean) {
    if (!open) return;
    try {
      setWallets((await listWallets()).wallets);
    } catch {
      toast.error("Failed to load wallets");
    }
  }

  async function addToList(list: TraderListView) {
    setBusy(true);
    try {
      await addTradersToList(list._id, addresses);
      toast.success(`${addresses.length} trader${addresses.length === 1 ? "" : "s"} added to "${list.name}"`);
      onListsChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add to list");
    } finally {
      setBusy(false);
    }
  }

  async function assignToWallet(wallet: WalletView) {
    setBusy(true);
    try {
      const result = await addTradersToWallet(wallet._id, addresses);
      if (result.blacklisted.length) toast.warning(`${result.blacklisted.length} blacklisted trader${result.blacklisted.length === 1 ? "" : "s"} skipped`);
      toast.success(`Assigned to "${wallet.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to assign to wallet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="region" aria-label="Selected traders" className="flex flex-wrap items-center gap-3 border-b border-volt-line bg-volt-soft px-4 py-2.5">
      <b className="text-[13px] text-primary">{addresses.length} selected</b>
      <span className="hidden h-4 w-px bg-line-2 sm:block" />
      <DropdownMenu onOpenChange={loadLists}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Tag />}
            Add to list
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Add selected to list</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {lists === null ? (
            <div className="px-2 py-1.5 text-xs text-text-3">Loading…</div>
          ) : lists.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-3">No lists yet - create one from a trader&apos;s row menu.</div>
          ) : (
            lists.map((list) => (
              <DropdownMenuItem key={list._id} onSelect={() => addToList(list)} className="min-h-9 justify-between">
                <span className="truncate">{list.name}</span>
                <span className="text-xs text-text-3">{list.memberCount}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu onOpenChange={loadWallets}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            <WalletIcon />
            Assign to wallet
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Assign selected to wallet</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {wallets === null ? (
            <div className="px-2 py-1.5 text-xs text-text-3">Loading…</div>
          ) : wallets.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-3">No wallets yet - create one on Sim wallets.</div>
          ) : (
            wallets.map((wallet) => (
              <DropdownMenuItem key={wallet._id} onSelect={() => assignToWallet(wallet)} className="min-h-9 flex-col items-start gap-0">
                <span className="truncate">{wallet.name}</span>
                <span className="text-[11px] text-text-3">{formatUsd(wallet.balanceUsd)} available</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {onBlacklist ? (
        <Button variant="destructive" size="sm" onClick={onBlacklist} disabled={busy}>
          <Ban />
          Blacklist
        </Button>
      ) : null}
      <div className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
