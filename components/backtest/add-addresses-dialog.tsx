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
import { addBacktestAddresses } from "@/lib/backtest-api";

const ADDRESS_LIKE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * One address per line, optionally followed by a label ("<address> My label"
 * or "<address>,My label"). A line holding only addresses (space/comma
 * separated) adds each of them - so a pasted comma-separated list works too.
 */
export function parseAddressInput(text: string): Array<{ address: string; label: string }> {
  const out: Array<{ address: string; label: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    if (tokens.every((t) => ADDRESS_LIKE.test(t))) {
      for (const t of tokens) out.push({ address: t, label: "" });
    } else {
      const [address, ...rest] = tokens;
      out.push({ address, label: rest.join(" ") });
    }
  }
  return out;
}

export function AddAddressesDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const entries = parseAddressInput(text);
    if (entries.length === 0) {
      toast.error("Paste at least one address");
      return;
    }
    setSubmitting(true);
    try {
      const { added, skipped, blacklisted = [], invalid } = await addBacktestAddresses(entries);
      const parts: string[] = [];
      if (added.length) parts.push(`${added.length} added`);
      if (skipped.length) parts.push(`${skipped.length} already on the list`);
      if (blacklisted.length) parts.push(`${blacklisted.length} blacklisted (not added)`);
      if (invalid.length) parts.push(`${invalid.length} invalid`);
      if (added.length > 0) toast.success(parts.join(", "));
      else toast.error(parts.join(", ") || "Nothing added");
      if (invalid.length > 0) toast.error(`Not valid Solana addresses: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}`);
      if (added.length > 0 || skipped.length > 0 || blacklisted.length > 0) {
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
            One address per line, optionally followed by a label. Backtest addresses aren&apos;t live-tracked, so there is no per-RPC limit and
            adding one never affects your Traders list. Duplicates are skipped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="backtest-addresses">Addresses</Label>
          <Textarea
            id="backtest-addresses"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"9WKubigWRHGLafKcev275D1AGrzPFsUD4oCg76mQgAjg  Sniper #1\nHmBmSYwYEgEZuBUYuDs9xofyqBAkw4ywugB1d7R7sTGh"}
            className="min-h-40 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">{parseAddressInput(text).length} address(es) detected</p>
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
