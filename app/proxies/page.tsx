"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Plus, RefreshCw, ShieldAlert, Shuffle, Square, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addProxiesBulk, deleteProxiesBulk, deleteProxy, listProxies, testProxy, updateProxy } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import type { ProxyView } from "@/lib/types";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: ProxyView["status"] }) {
  if (status === "blacklisted") {
    return (
      <Badge className="gap-1 border-negative/30 bg-negative/15 text-negative">
        <ShieldAlert className="size-3" /> Blacklisted
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 border-positive/30 bg-positive/15 text-positive">
      <CheckCircle2 className="size-3" /> Active
    </Badge>
  );
}

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
function parseProxyInput(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  for (const candidate of [trimmed, `[${trimmed.replace(/,\s*$/, "")}]`]) {
    try {
      const parsed = JSON.parse(candidate);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const urls = entries.map(hostPortToUrl).filter((u): u is string => !!u);
      if (urls.length > 0) return urls;
    } catch {
      // not valid JSON (or not this shape) - fall through to the next candidate / plain-text parsing
    }
  }

  return trimmed
    .split(/[\n,]/)
    .map((u) => u.trim())
    .filter(Boolean);
}

function AddProxiesDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const urls = parseProxyInput(text);
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
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Add proxies
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add proxies</DialogTitle>
          <DialogDescription>
            One proxy per line (or comma-separated) - e.g. http://user:pass@host:port or socks5://host:port. You
            can also paste a JSON list of {"{host, port, username, password}"} objects (with or without the
            surrounding brackets) - a common export format from proxy providers. The pump.fun API client
            round-robins through every enabled, healthy proxy here; with none configured, it calls directly,
            exactly as before.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="proxy-list">Proxy URLs</Label>
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
            className="field-sizing-fixed h-40 max-h-40 resize-none overflow-x-hidden overflow-y-auto font-mono text-sm break-all whitespace-pre-wrap"
          />
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

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<ProxyView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTest, setBulkTest] = useState<{ done: number; total: number; passed: number } | null>(null);
  const cancelBulkTest = useRef(false);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { proxies } = await listProxies();
      setProxies(proxies);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Failed to load proxies");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => refresh({ silent: true }), 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    // Drop selections for rows that no longer exist (e.g. deleted elsewhere).
    if (!proxies) return;
    const ids = new Set(proxies.map((p) => p._id));
    setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
  }, [proxies]);

  async function handleToggleEnabled(proxy: ProxyView, enabled: boolean) {
    setPendingId(proxy._id);
    try {
      await updateProxy(proxy._id, { enabled });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update proxy");
    } finally {
      setPendingId(null);
    }
  }

  async function handleTest(proxy: ProxyView) {
    setTestingId(proxy._id);
    try {
      const { ok, error } = await testProxy(proxy._id);
      if (ok) toast.success(`${proxy.label || proxy.url}: working`);
      else toast.error(`${proxy.label || proxy.url}: ${error || "failed"}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestingId(null);
    }
  }

  /**
   * Re-tests a set of proxies one after another (a few at a time, so a big
   * list finishes in reasonable time without flooding pump.fun from many
   * IPs at once). Each pass un-blacklists the proxy; `enableOnSuccess` also
   * switches a disabled proxy back on, so working ones go straight back into
   * rotation without scrolling to each one.
   */
  async function runBulkTest(targets: ProxyView[], { enableOnSuccess }: { enableOnSuccess: boolean }) {
    if (targets.length === 0 || bulkTest) return;
    cancelBulkTest.current = false;
    let done = 0;
    let passed = 0;
    setBulkTest({ done, total: targets.length, passed });

    const queue = [...targets];
    const CONCURRENCY = 3;
    async function worker() {
      while (queue.length > 0 && !cancelBulkTest.current) {
        const proxy = queue.shift()!;
        setTestingId(proxy._id);
        const ok = await testProxy(proxy._id, { enableOnSuccess })
          .then((r) => r.ok)
          .catch(() => false);
        done += 1;
        if (ok) passed += 1;
        setBulkTest({ done, total: targets.length, passed });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

    setTestingId(null);
    setBulkTest(null);
    await refresh({ silent: true });
    const stopped = cancelBulkTest.current ? " (stopped early)" : "";
    const message = `Tested ${done} prox${done === 1 ? "y" : "ies"}${stopped}: ${passed} working${enableOnSuccess ? " and re-activated" : ""}, ${done - passed} failed`;
    if (passed > 0) toast.success(message);
    else toast.error(message);
  }

  async function handleDelete(proxy: ProxyView) {
    setPendingId(proxy._id);
    try {
      await deleteProxy(proxy._id);
      toast.success("Proxy deleted");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete proxy");
    } finally {
      setPendingId(null);
    }
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await deleteProxiesBulk(ids);
      toast.success(`${ids.length} prox${ids.length === 1 ? "y" : "ies"} deleted`);
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk delete failed");
    }
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allSelected = (proxies?.length ?? 0) > 0 && selected.size === proxies?.length;
  const blacklistedCount = useMemo(() => (proxies ?? []).filter((p) => p.status === "blacklisted").length, [proxies]);
  const inactiveProxies = useMemo(() => (proxies ?? []).filter((p) => p.status === "blacklisted" || !p.enabled), [proxies]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Shuffle className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Proxies</h1>
            <p className="text-sm text-muted-foreground">
              Rotated round-robin by the pump.fun API client to spread requests across more than one origin IP.
              A proxy that fails 3 times in a row is auto-blacklisted and skipped until it passes a test again.
            </p>
          </div>
        </div>
        <AddProxiesDialog onAdded={refresh} />
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-muted-foreground">
          {proxies?.length ?? 0} prox{(proxies?.length ?? 0) === 1 ? "y" : "ies"}
        </div>
        {blacklistedCount > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-negative/30 bg-negative/10 px-3 py-1.5 text-negative">
            <AlertTriangle className="size-3.5" />
            {blacklistedCount} blacklisted
          </div>
        )}
        {bulkTest ? (
          <div className="inline-flex items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Testing {bulkTest.done}/{bulkTest.total} - {bulkTest.passed} working
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => (cancelBulkTest.current = true)}>
              <Square className="size-3.5" /> Stop
            </Button>
          </div>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={inactiveProxies.length === 0}
              onClick={() => runBulkTest(inactiveProxies, { enableOnSuccess: true })}
              title="Tests every blacklisted or disabled proxy one by one, and re-activates the ones that work"
            >
              <RefreshCw className="size-3.5" />
              Re-test blacklisted &amp; disabled ({inactiveProxies.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={!proxies || proxies.length === 0}
              onClick={() => runBulkTest(proxies ?? [], { enableOnSuccess: false })}
              title="Tests every proxy - working ones are un-blacklisted, failing ones count toward blacklisting. Enabled/disabled switches are left as they are."
            >
              <CheckCircle2 className="size-3.5" />
              Test all
            </Button>
          </>
        )}
        {selected.size > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-negative hover:text-negative">
                <Trash2 className="size-3.5" />
                Delete {selected.size} selected
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selected.size} prox{selected.size === 1 ? "y" : "ies"}?</AlertDialogTitle>
                <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-negative text-negative-foreground hover:bg-negative/90"
                  onClick={handleBulkDelete}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {loading && !proxies ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : !proxies || proxies.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
          <p className="text-sm text-muted-foreground">No proxies configured yet - the API client calls directly.</p>
        </div>
      ) : (
        <Card className="overflow-hidden border-border/60">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(proxies.map((p) => p._id)) : new Set())}
                      className="size-4 rounded border-border accent-primary"
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Proxy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Failures</TableHead>
                  <TableHead className="text-right">Last checked</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proxies.map((proxy) => {
                  const isPending = pendingId === proxy._id;
                  const isTesting = testingId === proxy._id;
                  return (
                    <TableRow key={proxy._id} className="border-border/60">
                      <TableCell className="pl-4">
                        <input
                          type="checkbox"
                          checked={selected.has(proxy._id)}
                          onChange={(e) => toggleRow(proxy._id, e.target.checked)}
                          className="size-4 rounded border-border accent-primary"
                          aria-label={`Select ${proxy.url}`}
                        />
                      </TableCell>
                      <TableCell className="max-w-3xs sm:max-w-xs">
                        {/*
                          TableCell defaults to whitespace-nowrap with no
                          width cap (components/ui/table.tsx) - a long
                          single-line string here (like a raw curl error)
                          otherwise has nothing to clip against, so the
                          browser's table-layout:auto sizes the WHOLE COLUMN
                          (and therefore the table) to fit it, which is what
                          forced the outer horizontal scroll in the
                          reported bug instead of the text truncating in
                          its own cell. max-w on the cell + min-w-0 on the
                          flex child are both required - the cap alone
                          isn't enough, a flex item's default min-width:auto
                          still lets it overflow its capped parent.
                        */}
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate font-mono text-xs">{proxy.url}</span>
                          {proxy.label ? <span className="truncate text-xs text-muted-foreground">{proxy.label}</span> : null}
                          {proxy.lastError ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate text-[11px] text-negative/80">{proxy.lastError}</span>
                              </TooltipTrigger>
                              <TooltipContent className="break-words">{proxy.lastError}</TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={proxy.status} />
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-sm",
                          proxy.consecutiveFailures > 0 ? "text-negative" : "text-muted-foreground"
                        )}
                      >
                        {proxy.consecutiveFailures}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatRelativeTime(proxy.lastCheckedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <Switch
                            checked={proxy.enabled}
                            disabled={isPending}
                            onCheckedChange={(checked) => handleToggleEnabled(proxy, checked)}
                            aria-label="Enable proxy"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isTesting || !!bulkTest}
                            onClick={() => handleTest(proxy)}
                            className="gap-1.5"
                          >
                            {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                            Test
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" disabled={isPending} className="text-muted-foreground hover:text-negative">
                                <Trash2 className="size-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this proxy?</AlertDialogTitle>
                                <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-negative text-negative-foreground hover:bg-negative/90"
                                  onClick={() => handleDelete(proxy)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
