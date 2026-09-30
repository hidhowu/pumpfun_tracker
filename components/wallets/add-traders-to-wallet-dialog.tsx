"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { addTradersToWallet, listTraders } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress } from "@/lib/format";
import type { Trader } from "@/lib/types";

type Props = { walletId: string; existingAddresses: string[]; onAdded: () => void };

/** Bulk-assign existing tracked traders to a wallet - same checkbox-list-with-search shape as /proxies' bulk actions, but selecting from a fetched list rather than pasted text. */
export function AddTradersToWalletDialog({ walletId, existingAddresses, onAdded }: Props) {
  const { currentProfileId } = useProfile();
  const [open, setOpen] = useState(false);
  const [traders, setTraders] = useState<Trader[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !currentProfileId) return;
    setLoading(true);
    setSelected(new Set());
    listTraders(currentProfileId, "active")
      .then(({ traders }) => setTraders(traders))
      .catch(() => toast.error("Failed to load traders"))
      .finally(() => setLoading(false));
  }, [open, currentProfileId]);

  const existing = useMemo(() => new Set(existingAddresses), [existingAddresses]);
  const candidates = useMemo(() => {
    const pool = (traders ?? []).filter((t) => !existing.has(t.address));
    const q = search.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((t) => t.address.toLowerCase().includes(q) || t.label.toLowerCase().includes(q));
  }, [traders, existing, search]);

  function toggle(address: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(address);
      else next.delete(address);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    try {
      const { added } = await addTradersToWallet(walletId, [...selected]);
      toast.success(`${added.length} trader${added.length === 1 ? "" : "s"} added to this wallet`);
      setOpen(false);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add traders");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          Add traders
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add traders to this wallet</DialogTitle>
          <DialogDescription>
            Every real buy/sell from a selected trader will be mirrored against this wallet&apos;s own balance and
            settings, starting from zero - independent of that trader&apos;s own performance elsewhere.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search address or label" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>

        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
          ) : candidates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {traders && traders.length > 0 ? "No matching traders (or all already assigned)." : "No active traders tracked yet."}
            </p>
          ) : (
            candidates.map((trader) => (
              <label
                key={trader.address}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={selected.has(trader.address)}
                  onChange={(e) => toggle(trader.address, e.target.checked)}
                  className="size-4 rounded border-border accent-primary"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs">{formatAddress(trader.address, 6)}</span>
                  {trader.label ? <span className="truncate text-xs text-muted-foreground">{trader.label}</span> : null}
                </span>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || selected.size === 0}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Add {selected.size > 0 ? selected.size : ""} trader{selected.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
