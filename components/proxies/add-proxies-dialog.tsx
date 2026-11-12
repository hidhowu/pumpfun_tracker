"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DialogHead, Field } from "@/components/ui/dialog-parts";
import { Textarea } from "@/components/ui/textarea";
import { addProxiesBulk } from "@/lib/api";

type HostPortEntry = { host?: string; port?: number | string; username?: string; password?: string; scheme?: string };

function hostPortToUrl(entry: HostPortEntry): string | null {
  if (!entry || typeof entry !== "object" || !entry.host || !entry.port) return null;
  const scheme = entry.scheme || "http"; // these host/port/username/password proxy lists are conventionally plain HTTP proxies unless stated otherwise
  const auth = entry.username ? `${encodeURIComponent(entry.username)}:${encodeURIComponent(entry.password ?? "")}@` : "";
  return `${scheme}://${auth}${entry.host}:${entry.port}`;
}

/**
 * Accepts either the existing plain-URL format (one per line/comma, e.g.
 * "http://user:pass@host:port") OR a pasted JSON {host,port,username,password}
 * object/array - including the common copy-paste artifact of an object list
 * with a trailing comma and no surrounding [] (exactly what a "copy" button
 * on a proxy provider's dashboard tends to produce). JSON is tried first;
 * only text that isn't valid JSON falls through to the line/comma splitter,
 * so the two formats can't be accidentally cross-parsed.
 */
export function parseProxyInput(text: string): { urls: string[]; fromJson: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { urls: [], fromJson: false };

  for (const candidate of [trimmed, `[${trimmed.replace(/,\s*$/, "")}]`]) {
    try {
      const parsed = JSON.parse(candidate);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const urls = entries.map(hostPortToUrl).filter((u): u is string => !!u);
      if (urls.length > 0) return { urls, fromJson: true };
    } catch {
      // not valid JSON (or not this shape) - fall through to the next candidate / plain-text parsing
    }
  }

  return {
    urls: trimmed
      .split(/[\n,]/)
      .map((u) => u.trim())
      .filter(Boolean),
    fromJson: false,
  };
}

export function AddProxiesDialog({ onAdded, trigger }: { onAdded: () => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const detected = parseProxyInput(text);

  async function handleSubmit() {
    const { urls } = parseProxyInput(text);
    if (urls.length === 0) {
      toast.error("Paste at least one proxy URL");
      return;
    }
    setSubmitting(true);
    try {
      const { added, skipped, invalid } = await addProxiesBulk(urls);
      const parts: string[] = [];
      if (added.length) parts.push(`${added.length} added`);
      if (skipped.length) parts.push(`${skipped.length} already registered`);
      if (invalid.length) parts.push(`${invalid.length} invalid`);
      if (added.length > 0) toast.success(parts.join(", "));
      else toast.error(parts.join(", ") || "Nothing added");
      setText("");
      setOpen(false);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add proxies");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-1.5 max-md:h-11 max-md:w-full">
            <Plus className="size-4" />
            Add proxies
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHead
          icon={<Shuffle className="size-5" />}
          title="Add proxies"
          help="One proxy per line or comma-separated, e.g. http://user:pass@host:port or socks5://host:port. A JSON list of {host, port, username, password} works too, with or without the surrounding brackets. With none configured the pump.fun client calls directly."
        />
        <Field
          label="Proxy URLs"
          htmlFor="proxy-list"
          note={
            detected.urls.length > 0 ? (
              <>
                Detected: {detected.urls.length} prox{detected.urls.length === 1 ? "y" : "ies"}
                {detected.fromJson ? " (from JSON)" : ""}
              </>
            ) : undefined
          }
        >
          <Textarea
            id="proxy-list"
            placeholder={'http://user:pass@host1:port\nsocks5://host2:port\n\nor:\n{ "host": "1.2.3.4", "port": 8105, "username": "u", "password": "p" }'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            // The base Textarea uses field-sizing:content (grows to fit
            // whatever's pasted, in both directions, unbounded) - fine for a
            // short chat-style input, broken for pasting a big bulk list:
            // it pushes the dialog's own Cancel/Add buttons off-screen with
            // no way to reach them. Same fix as add-trader-dialog.tsx's bulk
            // tab: a fixed box that scrolls internally instead.
            className="field-sizing-fixed h-40 max-h-40 resize-none overflow-x-hidden overflow-y-auto font-mono text-sm break-all whitespace-pre-wrap max-sm:h-32 max-sm:max-h-32"
          />
        </Field>
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
