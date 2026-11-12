"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Plus, Router, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DialogHead, Field } from "@/components/ui/dialog-parts";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TestResultLine } from "@/components/rpc/parts";
import { addHttpRpcEndpoint, addRpcEndpoint, probeRpcUrl } from "@/lib/api";
import type { RpcTestResult } from "@/lib/types";

/** "Test" for a URL typed into an Add dialog - checks it before it's saved, so a dead or rate-limited one never gets added blind. */
function UrlProbe({ kind, url }: { kind: "ws" | "http"; url: string }) {
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<{ url: string; result: RpcTestResult } | null>(null);
  const trimmed = url.trim();

  async function run() {
    setTesting(true);
    try {
      setOutcome({ url: trimmed, result: await probeRpcUrl(kind, trimmed) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  const shown = outcome && outcome.url === trimmed ? outcome.result : null; // a result for an older URL is stale once the URL changes
  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5 max-sm:h-11" disabled={!trimmed || testing} onClick={run}>
        {testing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
        Test this endpoint
      </Button>
      {shown && <TestResultLine test={{ at: new Date().toISOString(), verdict: shown.verdict, latencyMs: shown.latencyMs, message: shown.message }} />}
    </div>
  );
}

export function AddRpcDialog({ onAdded, trigger }: { onAdded: () => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!url.trim()) {
      toast.error("Enter a WebSocket RPC URL");
      return;
    }
    setSubmitting(true);
    try {
      await addRpcEndpoint(url.trim(), label.trim() || undefined);
      toast.success("RPC endpoint added");
      setUrl("");
      setLabel("");
      setOpen(false);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add RPC endpoint");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-1.5 max-md:h-11 max-md:flex-1">
            <Plus className="size-4" />
            Add RPC
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHead
          icon={<Router className="size-5" />}
          title="Add an RPC endpoint"
          help="Tracked addresses are spread evenly across every active endpoint. Adding more, ideally from a different provider, relieves any single provider's requests-per-second limit."
        />
        <div className="flex flex-col gap-4">
          <Field label="WebSocket URL" htmlFor="rpc-url">
            <Input id="rpc-url" placeholder="wss://your-provider.example.com/ws/..." value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-sm" />
          </Field>
          <Field label="Label" optional htmlFor="rpc-label">
            <Input id="rpc-label" placeholder="e.g. Chainstack #2" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <UrlProbe kind="ws" url={url} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Add endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddHttpRpcDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"both" | "backtest">("both");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!url.trim()) {
      toast.error("Enter an HTTP RPC URL");
      return;
    }
    setSubmitting(true);
    try {
      await addHttpRpcEndpoint(url.trim(), label.trim() || undefined, scope);
      toast.success("HTTP RPC endpoint added");
      setUrl("");
      setLabel("");
      setScope("both");
      setOpen(false);
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add HTTP RPC endpoint");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1.5 max-md:h-11 max-md:w-full">
          <Plus className="size-4" />
          Add HTTP RPC
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHead
          icon={<Zap className="size-5" />}
          title="Add an HTTP RPC endpoint"
          help="Round-robinned for every non-websocket Solana RPC call (getTransaction, etc), separate from the WebSocket endpoints, which are only used for live log subscriptions."
        />
        <div className="flex flex-col gap-4">
          <Field label="HTTP URL" htmlFor="http-rpc-url">
            <Input id="http-rpc-url" placeholder="https://your-provider.example.com/v2/..." value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-sm" />
          </Field>
          <Field label="Label" optional htmlFor="http-rpc-label">
            <Input id="http-rpc-label" placeholder="e.g. Alchemy #2" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <UrlProbe kind="http" url={url} />
          <Field label="Used for" htmlFor="http-rpc-scope" help={<>&quot;Backtests only&quot; keeps slow or cheap providers out of live trade detection entirely.</>}>
            <Select value={scope} onValueChange={(v) => setScope(v as "both" | "backtest")}>
              <SelectTrigger id="http-rpc-scope" className="w-full max-sm:h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Live tracking + backtests</SelectItem>
                <SelectItem value="backtest">Backtests only</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Add endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
