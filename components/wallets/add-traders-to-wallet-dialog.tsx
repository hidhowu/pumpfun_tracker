"use client";

import { CopyButton } from "@/components/copy-button";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpTip } from "@/components/ui/help-tip";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="size-4" strokeWidth={2.2} />
        Add traders
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-md">
          <DialogHeader className="flex-row items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-primary">
              <UserPlus className="size-5" />
            </span>
            <DialogTitle>
              Add traders to this wallet
              <HelpTip>Every buy and sell from an added trader is mirrored on this wallet&apos;s own balance, starting from zero. Blacklisted traders are never added.</HelpTip>
            </DialogTitle>
            <DialogDescription className="sr-only">Pick tracked traders or paste addresses.</DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="select">
            <TabsList className="grid h-11 w-full grid-cols-2">
              <TabsTrigger value="select">Pick tracked</TabsTrigger>
              <TabsTrigger value="paste">Paste addresses</TabsTrigger>
            </TabsList>

            <TabsContent value="select" className="mt-4 flex flex-col gap-3">
              <label className="flex h-11 items-center gap-2 rounded-[10px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3">
                <Search className="size-4 shrink-0" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address or label" aria-label="Search address or label" className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]" />
                {search ? (
                  <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </label>

              <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)
                ) : candidates.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-2">{traders && traders.length > 0 ? "No matching traders (or all already assigned)." : "No active traders tracked yet."}</p>
                ) : (
                  candidates.map((trader) => (
                    <label key={trader.address} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2.5 hover:bg-surface-2">
                      <Checkbox checked={selected.has(trader.address)} onCheckedChange={(checked) => toggle(trader.address, checked === true)} aria-label={`Select ${trader.label || formatAddress(trader.address, 6)}`} />
                      <span className="flex min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-1">
                          <span className="truncate font-mono text-xs">{formatAddress(trader.address, 6)}</span>
                          <CopyButton value={trader.address} />
                        </span>
                        {trader.label ? <span className="truncate text-xs text-text-3">{trader.label}</span> : null}
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
                  {submitting && <Loader2 className="animate-spin" />}
                  Add {selected.size > 0 ? selected.size : ""} trader{selected.size === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </TabsContent>

            <TabsContent value="paste" className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wallet-paste">
                  Wallet addresses
                  <HelpTip>Addresses already in this wallet and blacklisted ones are skipped.</HelpTip>
                </Label>
                <Textarea
                  id="wallet-paste"
                  placeholder={"One per line, or comma/space-separated"}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  // Fixed-height scroll box - see add-trader-dialog.tsx's bulk tab for why.
                  className="field-sizing-fixed h-40 max-h-40 resize-none overflow-x-hidden overflow-y-auto font-mono text-sm break-all whitespace-pre-wrap"
                />
                <span className="text-xs text-text-3">{pasted.length} address{pasted.length === 1 ? "" : "es"} detected</span>
              </div>
              <div className="flex min-h-[52px] items-center justify-between gap-3 rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
                <b className="text-[13px] font-semibold">
                  Track new addresses
                  <HelpTip>Addresses not yet on the platform are added as tracked traders first. Off: they are skipped.</HelpTip>
                </b>
                <Switch aria-label="Track new addresses" checked={trackNew} onCheckedChange={setTrackNew} />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button onClick={() => submit(pasted, { trackNew })} disabled={submitting || pasted.length === 0}>
                  {submitting && <Loader2 className="animate-spin" />}
                  Add {pasted.length || ""} address{pasted.length === 1 ? "" : "es"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
