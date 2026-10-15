"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
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
import { ProgressBar } from "./shared";

const ADDRESS_LIKE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// A big paste is sent in batches this size, one after the other: one huge request would hang the page while it builds and the server while it handles it.
const BATCH_SIZE = 500;
const RETRY_DELAY_MS = 1500;

type Tally = { done: number; total: number; added: number; updated: number; skipped: number; blacklisted: number; invalid: string[] };
const EMPTY_TALLY: Tally = { done: 0, total: 0, added: 0, updated: 0, skipped: 0, blacklisted: 0, invalid: [] };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Accepts either:
 *  - JSON from pump.fun wallets - `[{ "walletAddress": "...", "userId": "..." }, ...]` (a single object works too). The user id is what makes
 *    collecting an address fast, so this is the preferred format;
 *  - plain text, one address per line, optionally followed by a label ("<address> My label" or "<address>,My label"). A line holding only
 *    addresses (space/comma separated) adds each of them. These have no user id, so the wallet address is used in its place.
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
  // null = not adding. While a big paste is being sent the dialog shows a progress screen instead of the form.
  const [tally, setTally] = useState<Tally | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const adding = tally !== null;

  // Reading thousands of lines on every keystroke would make typing lag, so the count follows a moment behind.
  const deferredText = useDeferredValue(text);
  const detected = useMemo(() => parseAddressInput(deferredText), [deferredText]);
  const withUserId = useMemo(() => detected.entries.filter((e) => e.userId).length, [detected]);

  /** One batch, tried twice before giving up (a brief network or server hiccup shouldn't lose a long paste). */
  async function sendBatch(batch: AddressEntry[]) {
    try {
      return await addBacktestAddresses(batch);
    } catch {
      await pause(RETRY_DELAY_MS);
      return addBacktestAddresses(batch);
    }
  }

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
    stopRequested.current = false;
    setStopping(false);
    let running: Tally = { ...EMPTY_TALLY, total: entries.length };
    setTally(running);
    let failure: string | null = null;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      if (stopRequested.current) break;
      const batch = entries.slice(i, i + BATCH_SIZE) as AddressEntry[];
      try {
        const res = await sendBatch(batch);
        running = {
          ...running,
          done: Math.min(entries.length, i + batch.length),
          added: running.added + res.added.length,
          updated: running.updated + (res.updated?.length ?? 0),
          skipped: running.skipped + res.skipped.length,
          blacklisted: running.blacklisted + (res.blacklisted?.length ?? 0),
          invalid: running.invalid.length < 50 ? [...running.invalid, ...res.invalid].slice(0, 50) : running.invalid,
        };
        setTally(running);
      } catch (e) {
        failure = e instanceof Error ? e.message : "Failed to add addresses";
        break;
      }
      await pause(0); // let the page repaint between batches
    }

    const parts: string[] = [];
    if (running.added) parts.push(`${running.added.toLocaleString()} added`);
    if (running.updated) parts.push(`${running.updated.toLocaleString()} updated with a user ID`);
    if (running.skipped) parts.push(`${running.skipped.toLocaleString()} already on the list`);
    if (running.blacklisted) parts.push(`${running.blacklisted.toLocaleString()} blacklisted (not added)`);
    if (running.invalid.length) parts.push(`${running.invalid.length}${running.invalid.length >= 50 ? "+" : ""} invalid`);
    const summary = parts.join(", ");
    const incomplete = running.done < entries.length;

    if (failure) {
      toast.error(
        `${failure}. ${running.done.toLocaleString()} of ${entries.length.toLocaleString()} were processed${summary ? ` (${summary})` : ""} - press Add again to continue: the ones already added are skipped.`
      );
    } else if (incomplete) {
      toast.message(
        `Stopped after ${running.done.toLocaleString()} of ${entries.length.toLocaleString()}${summary ? `: ${summary}` : ""}. Press Add again to continue - the ones already added are skipped.`
      );
    } else if (running.added > 0 || running.updated > 0) {
      toast.success(summary);
    } else {
      toast.error(summary || "Nothing added");
    }
    if (running.invalid.length > 0 && !failure) {
      toast.error(`Not valid (address or user ID): ${running.invalid.slice(0, 3).join(", ")}${running.invalid.length > 3 ? "…" : ""}`);
    }
    const anyEffect = running.added > 0 || running.updated > 0 || running.skipped > 0 || running.blacklisted > 0;
    if (anyEffect) onAdded();
    setTally(null);
    if (!failure && !incomplete && anyEffect) {
      setText("");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !adding && setOpen(next)}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Add addresses
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg"
        onInteractOutside={(e) => adding && e.preventDefault()}
        onEscapeKeyDown={(e) => adding && e.preventDefault()}
      >
        {adding && tally ? (
          <>
            <DialogHeader>
              <DialogTitle>Adding addresses…</DialogTitle>
              <DialogDescription>
                Sent in batches of {BATCH_SIZE} so the page and the server stay responsive. Closing is disabled until it finishes or you stop it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  {tally.done.toLocaleString()} of {tally.total.toLocaleString()}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">{Math.round((tally.done / tally.total) * 100)}%</span>
              </div>
              <ProgressBar percent={(tally.done / tally.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {tally.added.toLocaleString()} added · {tally.skipped.toLocaleString()} already on the list
                {tally.updated ? ` · ${tally.updated.toLocaleString()} updated` : ""}
                {tally.blacklisted ? ` · ${tally.blacklisted.toLocaleString()} blacklisted` : ""}
                {tally.invalid.length ? ` · ${tally.invalid.length} invalid` : ""}
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={stopping}
                onClick={() => {
                  stopRequested.current = true;
                  setStopping(true);
                }}
              >
                {stopping ? "Stopping after this batch…" : "Stop"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add addresses to backtest</DialogTitle>
              <DialogDescription>
                Paste JSON with each wallet&apos;s pump.fun user ID if you have it - the trades come straight from pump.fun, and the address is tried as a backup.
                Plain addresses (one per line, optionally followed by a label) work too: pump.fun accepts the wallet address in place of the user ID.
                Pasting an address that is already listed with a user ID gives it that ID. Adding one never affects your Traders list. Thousands at once are
                fine - they are sent in batches.
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
                {detected.entries.length.toLocaleString()} address(es) detected{detected.entries.length > 0 ? ` · ${withUserId.toLocaleString()} with a user ID` : ""}
                {detected.entries.length > BATCH_SIZE ? ` · will be sent in ${Math.ceil(detected.entries.length / BATCH_SIZE)} batches` : ""}
                {detected.error ? <span className="text-negative"> · {detected.error}</span> : null}
              </p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSubmit}>Add</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
