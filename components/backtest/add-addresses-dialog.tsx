"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { addBacktestAddresses, type AddressEntry } from "@/lib/backtest-api";

const ADDRESS_LIKE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Accepts either:
 *  - JSON from pump.fun wallets - `[{ "walletAddress": "...", "userId": "..." }, ...]` (a single object works too). The user id is what makes
 *    collecting an address fast, so this is the preferred format;
 *  - plain text, one address per line, optionally followed by a label ("<address> My label" or "<address>,My label"). A line holding only
 *    addresses (space/comma separated) adds each of them. These have no user id, so they are collected over RPC (slow).
 * Returns the entries, or `error` when the text looks like JSON but is not valid.
 */
export function parseAddressInput(text: string): { entries: Array<{ address: string; label: string; userId: string }>; error?: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const entries: Array<{ address: string; label: string; userId: string }> = [];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const address = [o.walletAddress, o.address, o.wallet].find((v) => typeof v === "string") as string | undefined;
        const userId = [o.userId, o.user_id].find((v) => typeof v === "string") as string | undefined;
        if (address) entries.push({ address: address.trim(), label: typeof o.label === "string" ? o.label : "", userId: userId?.trim() ?? "" });
      }
      return { entries };
    } catch {
      return { entries: [], error: "That looks like JSON but it isn't valid - check the brackets and quotes." };
    }
  }

  const out: Array<{ address: string; label: string; userId: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    if (tokens.every((t) => ADDRESS_LIKE.test(t))) {
      for (const t of tokens) out.push({ address: t, label: "", userId: "" });
    } else {
      const [address, ...rest] = tokens;
      out.push({ address, label: rest.join(" "), userId: "" });
    }
  }
  return { entries: out };
}

export function AddAddressesDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const detected = parseAddressInput(text);
  const withUserId = detected.entries.filter((e) => e.userId).length;

  async function handleSubmit() {
    const { entries, error } = parseAddressInput(text);
    if (error) {
      toast.error(error);
      return;
    }
    if (entries.length === 0) {
      toast.error("Paste at least one address");
      return;
    }
    setSubmitting(true);
    try {
      const { added, updated = [], skipped, blacklisted = [], invalid } = await addBacktestAddresses(entries as AddressEntry[]);
      const parts: string[] = [];
      if (added.length) parts.push(`${added.length} added`);
      if (updated.length) parts.push(`${updated.length} updated with a user ID`);
      if (skipped.length) parts.push(`${skipped.length} already on the list`);
      if (blacklisted.length) parts.push(`${blacklisted.length} blacklisted (not added)`);
      if (invalid.length) parts.push(`${invalid.length} invalid`);
      if (added.length > 0 || updated.length > 0) toast.success(parts.join(", "));
      else toast.error(parts.join(", ") || "Nothing added");
      if (invalid.length > 0) toast.error(`Not valid (address or user ID): ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}`);
      if (added.length > 0 || updated.length > 0 || skipped.length > 0 || blacklisted.length > 0) {
        setText("");
        setOpen(false);
        onAdded();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add addresses");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Add addresses
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add addresses to backtest</DialogTitle>
          <DialogDescription>
            Paste JSON with each wallet&apos;s pump.fun user ID - that is what makes a backtest fast, because the trades come straight from pump.fun.
            Plain addresses (one per line, optionally followed by a label) still work, but they are read from the chain over RPC, which is much slower.
            Pasting an address that is already listed with a user ID gives it that ID. Adding one never affects your Traders list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="backtest-addresses">Addresses</Label>
          <Textarea
            id="backtest-addresses"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              '[\n  {\n    "walletAddress": "HWaKJXeHTBRn9r1tQFcGSf1Z7o4iExYyrvyMTwYgseXF",\n    "userId": "49b89c4d-2398-4894-a82e-c0cbc941c1c5"\n  }\n]\n\nor plain addresses, one per line'
            }
            className="min-h-40 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            {detected.entries.length} address(es) detected{detected.entries.length > 0 ? ` · ${withUserId} with a user ID` : ""}
            {detected.error ? <span className="text-negative"> · {detected.error}</span> : null}
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
