"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { addTradersToWallet, listTraders } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress } from "@/lib/format";
import type { AddToWalletResult, Trader } from "@/lib/types";

type Props = { walletId: string; existingAddresses: string[]; onAdded: () => void };

function parseAddresses(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean))];
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function summarize(result: AddToWalletResult) {
  const parts: string[] = [];
  if (result.added.length) parts.push(`${plural(result.added.length, "trader")} added`);
  if (result.newlyTracked.length) parts.push(`${result.newlyTracked.length} newly tracked`);
  if (result.alreadyInWallet.length) parts.push(`${result.alreadyInWallet.length} already in this wallet`);
  if (result.blacklisted.length) parts.push(`${result.blacklisted.length} blacklisted (skipped)`);
  if (result.untracked.length) parts.push(`${result.untracked.length} not tracked (skipped)`);
  if (result.invalid.length) parts.push(`${result.invalid.length} invalid`);
  return parts.join(", ") || "Nothing to add.";
}

/**
 * Bulk-assign traders to a wallet, two ways: pick from already-tracked
 * active traders, or paste a list of addresses. Blacklisted addresses are
 * never assigned either way (the server enforces this too - see
 * db/walletService.js's addTradersToWallet).
 */
export function AddTradersToWalletDialog({ walletId, existingAddresses, onAdded }: Props) {
  const { currentProfileId } = useProfile();
  const [open, setOpen] = useState(false);
  const [traders, setTraders] = useState<Trader[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [trackNew, setTrackNew] = useState(true);
  const pasted = useMemo(() => parseAddresses(pasteText), [pasteText]);

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

  async function submit(addresses: string[], options: { trackNew?: boolean } = {}) {
    if (addresses.length === 0) return;
    setSubmitting(true);
    try {
      const result = await addTradersToWallet(walletId, addresses, options);
      const summary = summarize(result);
      if (result.added.length) toast.success(summary);
      else toast.info(summary);
      if (result.blacklisted.length) {
        toast.warning(`Skipped ${plural(result.blacklisted.length, "blacklisted address")}`, {
          description: result.blacklisted.map((a) => formatAddress(a)).join(", "),
        });
      }
      setPasteText("");
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
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add traders to this wallet</DialogTitle>
          <DialogDescription>
            Every real buy/sell from an added trader is mirrored against this wallet&apos;s own balance and settings,
            starting from zero. Blacklisted traders are never added.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="select">
          <TabsList className="w-full">
            <TabsTrigger value="select">Pick tracked</TabsTrigger>
            <TabsTrigger value="paste">Paste addresses</TabsTrigger>
          </TabsList>

          <TabsContent value="select" className="mt-3 flex flex-col gap-3">
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
              <Button onClick={() => submit([...selected])} disabled={submitting || selected.size === 0}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Add {selected.size > 0 ? selected.size : ""} trader{selected.size === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="paste" className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wallet-paste">Wallet addresses</Label>
              <Textarea
                id="wallet-paste"
                placeholder={"One per line, or comma/space-separated"}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                // Fixed-height scroll box - see add-trader-dialog.tsx's bulk tab for why.
                className="field-sizing-fixed h-40 max-h-40 resize-none overflow-x-hidden overflow-y-auto font-mono text-sm break-all whitespace-pre-wrap"
              />
              <p className="text-xs text-muted-foreground">
                {plural(pasted.length, "address")} detected. Addresses already in this wallet and blacklisted addresses
                are skipped.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <span className="flex flex-col">
                <span className="text-sm font-medium">Track new addresses</span>
                <span className="text-xs text-muted-foreground">
                  Addresses not on the platform yet are added as tracked traders first. Off: they&apos;re skipped.
                </span>
              </span>
              <Switch checked={trackNew} onCheckedChange={setTrackNew} />
            </label>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={() => submit(pasted, { trackNew })} disabled={submitting || pasted.length === 0}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Add {pasted.length || ""} address{pasted.length === 1 ? "" : "es"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
