"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addTraderSingle, addTradersBulk } from "@/lib/api";
import { formatAddress } from "@/lib/format";

function parseBulkInput(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function summarizeResult(added: string[], skipped: string[], blacklisted: string[], invalid: string[]) {
  const parts: string[] = [];
  if (added.length) parts.push(`${added.length} added`);
  if (skipped.length) parts.push(`${skipped.length} already tracked`);
  if (blacklisted.length) parts.push(`${blacklisted.length} blacklisted (skipped)`);
  if (invalid.length) parts.push(`${invalid.length} not a valid address`);
  if (parts.length === 0) return "Nothing to add.";
  return parts.join(", ");
}

export function AddTraderDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [singleAddress, setSingleAddress] = useState("");
  const [singleLabel, setSingleLabel] = useState("");

  const [bulkText, setBulkText] = useState("");
  const bulkAddresses = parseBulkInput(bulkText);

  function reset() {
    setSingleAddress("");
    setSingleLabel("");
    setBulkText("");
  }

  async function handleSingleSubmit() {
    const address = singleAddress.trim();
    if (!address) {
      toast.error("Enter a wallet address");
      return;
    }
    setSubmitting(true);
    try {
      const { added, skipped, blacklisted, invalid } = await addTraderSingle(address, singleLabel.trim() || undefined);
      if (added.length) {
        toast.success(`Now tracking ${formatAddress(address)}`);
      } else if (blacklisted.length) {
        toast.warning(`${formatAddress(address)} is blacklisted - not added. Un-blacklist it from the Blacklisted page to track it again.`);
      } else if (skipped.length) {
        toast.info(`${formatAddress(address)} is already tracked`);
      } else if (invalid.length) {
        toast.error(`${formatAddress(address)} is not a valid Solana address`);
      }
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add trader");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkSubmit() {
    if (bulkAddresses.length === 0) {
      toast.error("Paste at least one address");
      return;
    }
    setSubmitting(true);
    try {
      const { added, skipped, blacklisted, invalid } = await addTradersBulk(bulkAddresses);
      const summary = summarizeResult(added, skipped, blacklisted, invalid);
      if (added.length) toast.success(summary);
      else toast.info(summary);
      if (blacklisted.length) {
        toast.warning(`Skipped ${blacklisted.length} blacklisted address${blacklisted.length === 1 ? "" : "es"}`, {
          description: blacklisted.map((a) => formatAddress(a)).join(", "),
        });
      }
      reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add traders");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Add Trader
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add trader(s) to track</DialogTitle>
          <DialogDescription>
            Only new addresses are added. Anything already on the platform is skipped - including
            blacklisted addresses, which stay blacklisted and untracked.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="single">
          <TabsList className="w-full">
            <TabsTrigger value="single" className="flex-1">
              Single
            </TabsTrigger>
            <TabsTrigger value="bulk" className="flex-1">
              Bulk
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="single-address">Wallet address</Label>
              <Input
                id="single-address"
                placeholder="e.g. EgYa22bNrcQGRJny4rGJz8eJe5CSFKtXEqB9qPQQGN9p"
                value={singleAddress}
                onChange={(e) => setSingleAddress(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="single-label">Label (optional)</Label>
              <Input
                id="single-label"
                placeholder="e.g. Known whale #1"
                value={singleLabel}
                onChange={(e) => setSingleLabel(e.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSingleSubmit} disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Add trader
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="bulk" className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-addresses">Wallet addresses</Label>
              <Textarea
                id="bulk-addresses"
                placeholder={"One per line, or comma-separated:\nAddr1...\nAddr2..., Addr3..."}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                // The base Textarea uses field-sizing:content (grows to fit
                // whatever's pasted, in both directions, unbounded) - great
                // for a short chat-style input, actively broken for pasting
                // 100 addresses. Force it back to a fixed box that scrolls
                // internally instead, and wrap/break so one giant
                // comma-joined line can't stretch it sideways either.
                className="field-sizing-fixed h-40 max-h-40 resize-none overflow-x-hidden overflow-y-auto font-mono text-sm break-all whitespace-pre-wrap"
              />
              <p className="text-xs text-muted-foreground">
                {bulkAddresses.length} address{bulkAddresses.length === 1 ? "" : "es"} detected
              </p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleBulkSubmit} disabled={submitting || bulkAddresses.length === 0}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Add {bulkAddresses.length || ""} trader{bulkAddresses.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
