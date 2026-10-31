"use client";

import { CopyButton } from "@/components/copy-button";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Router,
  ShieldAlert,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addHttpRpcEndpoint,
  addRpcEndpoint,
  deleteHttpRpcEndpoint,
  deleteHttpRpcEndpointsBulk,
  deleteRpcEndpoint,
  deleteRpcEndpointsBulk,
  getRpcEndpointAddresses,
  listHttpRpcEndpoints,
  listRpcEndpoints,
  probeRpcUrl,
  reconnectRpcEndpoint,
  testRpcEndpoint,
  updateHttpRpcEndpoint,
  updateRpcEndpoint,
} from "@/lib/api";
import { formatAddress, formatRelativeTime } from "@/lib/format";
import type { HttpRpcEndpointView, RpcEndpointAddress, RpcEndpointHealth, RpcEndpointView, RpcTestResult } from "@/lib/types";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: RpcEndpointView["status"] }) {
  if (status === "connected") {
    return (
      <Badge className="gap-1 border-positive/30 bg-positive/15 text-positive">
        <Wifi className="size-3" /> Connected
      </Badge>
    );
  }
  if (status === "connecting") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" /> Connecting
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 border-negative/30 bg-negative/15 text-negative">
      <WifiOff className="size-3" /> Disconnected
    </Badge>
  );
}

/** Rate-limit failures in a row before an endpoint is blacklisted - mirrors RPC_FAILURE_THRESHOLD in db/rpcHealth.js. */
const FAILURE_THRESHOLD = 3;

type TestTarget = { _id: string; label: string; url: string };
type HealthTarget = TestTarget & RpcEndpointHealth & { enabled: boolean };

const isBlacklisted = (e: RpcEndpointHealth) => e.health === "blacklisted";
const nameOf = (e: TestTarget) => e.label || formatAddress(e.url, 12);

function BlacklistBadge({ endpoint }: { endpoint: RpcEndpointHealth }) {
  if (isBlacklisted(endpoint)) {
    return (
      <Badge
        className="gap-1 border-negative/30 bg-negative/15 text-negative"
        title={`Rate limited ${FAILURE_THRESHOLD} times in a row - skipped everywhere until it passes a test`}
      >
        <ShieldAlert className="size-3" /> Blacklisted
      </Badge>
    );
  }
  const strikes = endpoint.consecutiveFailures ?? 0;
  if (strikes > 0) {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px] font-normal text-amber-400" title="Failures in a row - blacklisted at 3">
        <AlertTriangle className="size-3" /> {strikes}/{FAILURE_THRESHOLD} strikes
      </Badge>
    );
  }
  return null;
}

const VERDICT_LABEL: Record<NonNullable<RpcEndpointHealth["lastTest"]>["verdict"], string> = {
  ok: "Healthy",
  slow: "Slow",
  rate_limited: "Rate limited",
  auth_failed: "Key rejected",
  unreachable: "Unreachable",
  error: "Error",
  no_signature: "Not tested",
};

function TestResultLine({ test }: { test: RpcEndpointHealth["lastTest"] }) {
  if (!test) return null;
  const tone = test.verdict === "ok" ? "text-positive" : test.verdict === "slow" ? "text-amber-400" : "text-negative";
  const Icon = test.verdict === "ok" ? CheckCircle2 : test.verdict === "slow" ? AlertTriangle : XCircle;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", tone)}>
      <Icon className="mt-0.5 size-3 shrink-0" />
      <span>
        <span className="font-medium">{VERDICT_LABEL[test.verdict]}</span>
        {test.message ? ` - ${test.message}` : ""}{" "}
        <span className="text-muted-foreground">(tested {formatRelativeTime(test.at)})</span>
      </span>
    </p>
  );
}

/**
 * Runs endpoint tests from the UI: one at a time (testOne) or a list two at a time (testMany), so a long
 * list finishes quickly without hammering providers - each test already makes up to 5 spaced-out requests on its own.
 * Every test is recorded server-side: a pass un-blacklists, a fail adds a strike (3 in a row blacklists).
 */
function useRpcTester(kind: "ws" | "http", refresh: (options?: { silent?: boolean }) => Promise<void>) {
  const [testingIds, setTestingIds] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);

  const setTesting = (id: string, on: boolean) =>
    setTestingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const testOne = useCallback(
    async (target: TestTarget, options: { enableOnSuccess?: boolean } = {}) => {
      setTesting(target._id, true);
      try {
        const result = await testRpcEndpoint(kind, target._id, options);
        if (result.ok) toast.success(`${nameOf(target)}: ${result.message}`);
        else toast.error(`${nameOf(target)}: ${result.message}`);
        await refresh({ silent: true });
        return result as RpcTestResult;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Test failed");
        return null;
      } finally {
        setTesting(target._id, false);
      }
    },
    [kind, refresh]
  );

  const testMany = useCallback(
    async (targets: TestTarget[], options: { enableOnSuccess?: boolean } = {}) => {
      if (targets.length === 0 || progress) return;
      cancelRef.current = false;
      const tally = { done: 0, healthy: 0, limited: 0, failed: 0 };
      setProgress({ done: 0, total: targets.length });

      const queue = [...targets];
      async function worker() {
        while (queue.length > 0 && !cancelRef.current) {
          const target = queue.shift()!;
          setTesting(target._id, true);
          const result = await testRpcEndpoint(kind, target._id, options).catch(() => null);
          setTesting(target._id, false);
          tally.done += 1;
          if (result?.ok) tally.healthy += 1;
          else if (result?.verdict === "rate_limited") tally.limited += 1;
          else tally.failed += 1;
          setProgress({ done: tally.done, total: targets.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));

      setProgress(null);
      await refresh({ silent: true });
      const parts = [`${tally.healthy} healthy`];
      if (tally.limited > 0) parts.push(`${tally.limited} rate limited (probably need upgrading)`);
      if (tally.failed > 0) parts.push(`${tally.failed} failed`);
      const message = `Tested ${tally.done} endpoint${tally.done === 1 ? "" : "s"}${cancelRef.current ? " (stopped early)" : ""}: ${parts.join(", ")}`;
      if (tally.limited + tally.failed > 0) toast.error(message);
      else toast.success(message);
    },
    [kind, refresh, progress]
  );

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { testingIds, progress, testOne, testMany, stop };
}

type RpcTester = ReturnType<typeof useRpcTester>;

/** Test all / re-test and delete the blacklisted ones - shared by the WebSocket and HTTP sections. */
function HealthToolbar({
  endpoints,
  tester,
  onDeleteMany,
}: {
  endpoints: HealthTarget[];
  tester: RpcTester;
  onDeleteMany: (ids: string[]) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const blacklisted = endpoints.filter(isBlacklisted);
  const busy = tester.progress !== null;

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDeleteMany(blacklisted.map((e) => e._id));
    } finally {
      setDeleting(false);
    }
  }

  if (endpoints.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {busy ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Testing {tester.progress!.done}/{tester.progress!.total}...
          </span>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={tester.stop}>
            <Square className="size-3.5" />
            Stop
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => tester.testMany(endpoints)}
          title="Tests every endpoint by fetching a known transaction (up to 5 tries, 1.5s apart; one success passes). A pass un-blacklists; a fail counts toward blacklisting."
        >
          <CheckCircle2 className="size-3.5" />
          Test all ({endpoints.length})
        </Button>
      )}
      {blacklisted.length > 0 && !busy && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => tester.testMany(blacklisted, { enableOnSuccess: true })}
            title="Tests every blacklisted endpoint and brings back the ones that now work"
          >
            <RefreshCw className="size-3.5" />
            Re-test blacklisted ({blacklisted.length})
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-negative hover:text-negative" disabled={deleting}>
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Delete blacklisted ({blacklisted.length})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {blacklisted.length} blacklisted endpoint{blacklisted.length === 1 ? "" : "s"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Only blacklisted endpoints are deleted - the rest are not touched. This can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-negative text-negative-foreground hover:bg-negative/90" onClick={handleDelete}>
                  Delete {blacklisted.length}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

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
    <div className="space-y-1.5">
      <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={!trimmed || testing} onClick={run}>
        {testing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
        Test this endpoint
      </Button>
      {shown && <TestResultLine test={{ at: new Date().toISOString(), verdict: shown.verdict, latencyMs: shown.latencyMs, message: shown.message }} />}
    </div>
  );
}

function SubStatusDot({ status }: { status: RpcEndpointAddress["subscriptionStatus"] }) {
  const color = status === "subscribed" ? "bg-positive" : status === "failed" ? "bg-negative" : "bg-amber-400";
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}

function AddRpcDialog({ onAdded }: { onAdded: () => void }) {
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
        <Button className="gap-1.5">
          <Plus className="size-4" />
          Add RPC
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an RPC endpoint</DialogTitle>
          <DialogDescription>
            Tracked addresses are spread evenly across every active endpoint - adding more (ideally from a
            different provider) relieves any single provider&apos;s requests-per-second limit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rpc-url">WebSocket URL</Label>
            <Input
              id="rpc-url"
              placeholder="wss://your-provider.example.com/ws/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rpc-label">Label (optional)</Label>
            <Input id="rpc-label" placeholder="e.g. Chainstack #2" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
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

function AddHttpRpcDialog({ onAdded }: { onAdded: () => void }) {
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
        <Button variant="outline" className="gap-1.5">
          <Plus className="size-4" />
          Add HTTP RPC
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an HTTP RPC endpoint</DialogTitle>
          <DialogDescription>
            Round-robinned for every non-websocket Solana RPC call (getTransaction, etc) - separate from the
            WebSocket endpoints above, which are only used for live log subscriptions.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="http-rpc-url">HTTP URL</Label>
            <Input
              id="http-rpc-url"
              placeholder="https://your-provider.example.com/v2/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="http-rpc-label">Label (optional)</Label>
            <Input id="http-rpc-label" placeholder="e.g. Alchemy #2" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <UrlProbe kind="http" url={url} />
          <div className="space-y-1.5">
            <Label htmlFor="http-rpc-scope">Used for</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as "both" | "backtest")}>
              <SelectTrigger id="http-rpc-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Live tracking + backtests</SelectItem>
                <SelectItem value="backtest">Backtests only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              &quot;Backtests only&quot; keeps slow or cheap providers out of live trade detection entirely.
            </p>
          </div>
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

function HttpRpcSection({ ref }: { ref?: Ref<{ testAll: () => Promise<void> }> }) {
  const [endpoints, setEndpoints] = useState<HttpRpcEndpointView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { endpoints } = await listHttpRpcEndpoints();
      setEndpoints(endpoints);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Failed to load HTTP RPC endpoints");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => refresh({ silent: true }), 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  const tester = useRpcTester("http", refresh);
  useImperativeHandle(ref, () => ({ testAll: () => tester.testMany(endpoints ?? []) }), [tester, endpoints]);

  async function handleDeleteMany(ids: string[]) {
    try {
      const { deletedCount } = await deleteHttpRpcEndpointsBulk(ids);
      toast.success(`${deletedCount} blacklisted HTTP RPC endpoint${deletedCount === 1 ? "" : "s"} deleted`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleToggleEnabled(endpoint: HttpRpcEndpointView, enabled: boolean) {
    setPendingId(endpoint._id);
    try {
      await updateHttpRpcEndpoint(endpoint._id, { enabled });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update endpoint");
    } finally {
      setPendingId(null);
    }
  }

  async function handleScopeChange(endpoint: HttpRpcEndpointView, scope: "both" | "backtest") {
    setPendingId(endpoint._id);
    try {
      await updateHttpRpcEndpoint(endpoint._id, { scope });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update endpoint");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(endpoint: HttpRpcEndpointView) {
    setPendingId(endpoint._id);
    try {
      await deleteHttpRpcEndpoint(endpoint._id);
      toast.success("HTTP RPC endpoint deleted");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete endpoint");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Zap className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight">HTTP RPC endpoints (round-robin)</h2>
            <p className="text-sm text-muted-foreground">
              Used for every non-websocket call - falls back to .env&apos;s SOLANA_RPC_URLS automatically when empty.
            </p>
          </div>
        </div>
        <AddHttpRpcDialog onAdded={refresh} />
      </div>

      <HealthToolbar endpoints={endpoints ?? []} tester={tester} onDeleteMany={handleDeleteMany} />

      {loading && !endpoints ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : !endpoints || endpoints.length === 0 ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
          <p className="text-sm text-muted-foreground">
            None configured - calls use .env&apos;s SOLANA_RPC_URLS only.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden border-border/60">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Used for</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => {
                  const isPending = pendingId === endpoint._id;
                  const isTesting = tester.testingIds.has(endpoint._id);
                  return (
                    <TableRow key={endpoint._id} className={cn("border-border/60", isBlacklisted(endpoint) && "bg-negative/5")}>
                      <TableCell className="max-w-3xs sm:max-w-xs">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate font-medium">{endpoint.label || "Unlabeled endpoint"}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">{endpoint.url}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-3xs whitespace-normal sm:max-w-xs">
                        <div className="flex flex-col gap-1">
                          <BlacklistBadge endpoint={endpoint} />
                          {endpoint.lastTest ? (
                            <TestResultLine test={endpoint.lastTest} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Not tested yet</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={endpoint.scope ?? "both"}
                          disabled={isPending}
                          onValueChange={(v) => handleScopeChange(endpoint, v as "both" | "backtest")}
                        >
                          <SelectTrigger size="sm" className="w-[11.5rem]" aria-label="Endpoint scope">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both">Live + backtests</SelectItem>
                            <SelectItem value="backtest">Backtests only</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <Switch
                            checked={endpoint.enabled}
                            disabled={isPending}
                            onCheckedChange={(checked) => handleToggleEnabled(endpoint, checked)}
                            aria-label="Enable endpoint"
                          />
                        </div>
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending || isTesting || tester.progress !== null}
                          onClick={() => tester.testOne(endpoint, { enableOnSuccess: isBlacklisted(endpoint) })}
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
                              <AlertDialogTitle>Delete this HTTP RPC endpoint?</AlertDialogTitle>
                              <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-negative text-negative-foreground hover:bg-negative/90"
                                onClick={() => handleDelete(endpoint)}
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

export default function RpcPage() {
  const [endpoints, setEndpoints] = useState<RpcEndpointView[] | null>(null);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [unresolvedAddresses, setUnresolvedAddresses] = useState<RpcEndpointAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<RpcEndpointAddress[] | null>(null);
  const [addressesLoading, setAddressesLoading] = useState(false);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { endpoints, unresolvedCount, unresolvedAddresses } = await listRpcEndpoints();
      setEndpoints(endpoints);
      setUnresolvedCount(unresolvedCount);
      setUnresolvedAddresses(unresolvedAddresses);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Failed to load RPC endpoints");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => refresh({ silent: true }), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const tester = useRpcTester("ws", refresh);
  const httpSectionRef = useRef<{ testAll: () => Promise<void> }>(null);
  const [testingEverything, setTestingEverything] = useState(false);

  /** One click for the whole page: the WebSocket endpoints and the HTTP ones, together. */
  async function handleTestEverything() {
    setTestingEverything(true);
    try {
      await Promise.all([tester.testMany(endpoints ?? []), httpSectionRef.current?.testAll()]);
    } finally {
      setTestingEverything(false);
    }
  }

  async function handleDeleteMany(ids: string[]) {
    try {
      const { deletedCount } = await deleteRpcEndpointsBulk(ids);
      toast.success(`${deletedCount} blacklisted endpoint${deletedCount === 1 ? "" : "s"} deleted`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function toggleExpand(endpoint: RpcEndpointView) {
    if (expandedId === endpoint._id) {
      setExpandedId(null);
      setAddresses(null);
      return;
    }
    setExpandedId(endpoint._id);
    setAddresses(null);
    setAddressesLoading(true);
    try {
      const { addresses } = await getRpcEndpointAddresses(endpoint._id);
      setAddresses(addresses);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load addresses for this endpoint");
    } finally {
      setAddressesLoading(false);
    }
  }

  async function handleToggleEnabled(endpoint: RpcEndpointView, enabled: boolean) {
    setPendingId(endpoint._id);
    try {
      await updateRpcEndpoint(endpoint._id, { enabled });
      toast.success(enabled ? "Endpoint enabled" : "Endpoint disabled");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update endpoint");
    } finally {
      setPendingId(null);
    }
  }

  async function handleReconnect(endpoint: RpcEndpointView) {
    setPendingId(endpoint._id);
    try {
      await reconnectRpcEndpoint(endpoint._id);
      toast.success(`Reconnect requested for ${endpoint.label || formatAddress(endpoint.url, 12)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to request reconnect");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(endpoint: RpcEndpointView) {
    setPendingId(endpoint._id);
    try {
      await deleteRpcEndpoint(endpoint._id);
      toast.success("Endpoint deleted - its addresses will be redistributed shortly");
      if (expandedId === endpoint._id) setExpandedId(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete endpoint");
    } finally {
      setPendingId(null);
    }
  }

  const totalAddresses = endpoints?.reduce((sum, e) => sum + e.addressCount, 0) ?? 0;
  const blacklistedCount = (endpoints ?? []).filter(isBlacklisted).length;
  const endpointLabelByUrl = new Map((endpoints ?? []).map((e) => [e.url, e.label || formatAddress(e.url, 12)]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Router className="size-4.5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">RPC endpoints</h1>
            <p className="text-sm text-muted-foreground">
              Tracked addresses are spread across every active endpoint below, so no single provider&apos;s
              rate limit gets hit as hard.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            disabled={testingEverything || tester.progress !== null}
            onClick={handleTestEverything}
            title="Tests every WebSocket and HTTP endpoint by fetching a known transaction (one success in up to 5 tries passes)"
          >
            {testingEverything ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Test all RPC
          </Button>
          <AddRpcDialog onAdded={refresh} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-muted-foreground">
          {endpoints?.length ?? 0} endpoint{(endpoints?.length ?? 0) === 1 ? "" : "s"}
        </div>
        <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-muted-foreground">
          {totalAddresses} address{totalAddresses === 1 ? "" : "es"} tracked
        </div>
        {blacklistedCount > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-negative/30 bg-negative/10 px-3 py-1.5 text-negative">
            <ShieldAlert className="size-3.5" />
            {blacklistedCount} blacklisted
          </div>
        )}
        {unresolvedCount > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-negative/30 bg-negative/10 px-3 py-1.5 text-negative">
            <AlertTriangle className="size-3.5" />
            {unresolvedCount} address{unresolvedCount === 1 ? "" : "es"} not currently subscribed
          </div>
        )}
      </div>

      <HealthToolbar endpoints={endpoints ?? []} tester={tester} onDeleteMany={handleDeleteMany} />

      {unresolvedAddresses.length > 0 && (
        <Card className="border-negative/30 bg-negative/5">
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-1.5 text-sm font-medium text-negative">
              <AlertTriangle className="size-3.5" />
              Not currently tracked ({unresolvedAddresses.length})
            </div>
            <p className="text-xs text-muted-foreground">
              These addresses aren&apos;t confirmed live right now - &quot;pending&quot; means waiting on its endpoint
              (often mid-reconnect, or its subscribe call hasn&apos;t run yet), &quot;failed&quot; means an actual
              subscribe error (e.g. rate-limited). Both resolve on their own within about 15 seconds once the
              underlying endpoint is healthy - no action needed unless one stays stuck.
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {unresolvedAddresses.map((a) => (
                <div key={a.address} className="flex min-w-0 items-center gap-1.5 text-xs">
                  <SubStatusDot status={a.subscriptionStatus} />
                  <span className="inline-flex shrink-0 items-center gap-1">
                    <span className="truncate font-mono text-muted-foreground">{formatAddress(a.address, 5)}</span>
                    <CopyButton value={a.address} />
                  </span>
                  {a.label ? <span className="min-w-0 truncate text-muted-foreground/70">({a.label})</span> : null}
                  <span className="ml-auto shrink-0 truncate text-[11px] text-muted-foreground/70">
                    {a.assignedRpcUrl ? endpointLabelByUrl.get(a.assignedRpcUrl) ?? "unknown endpoint" : "unassigned"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {loading && !endpoints ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : !endpoints || endpoints.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
          <p className="text-sm text-muted-foreground">No RPC endpoints configured yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {endpoints.map((endpoint) => {
            const isPending = pendingId === endpoint._id;
            const isExpanded = expandedId === endpoint._id;
            const isTesting = tester.testingIds.has(endpoint._id);
            const blacklisted = isBlacklisted(endpoint);
            return (
              <Card key={endpoint._id} className={cn("border-border/60", blacklisted && "border-negative/30 bg-negative/5")}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => toggleExpand(endpoint)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{endpoint.label || "Unlabeled endpoint"}</span>
                          <Badge variant="secondary" className="text-[10px] font-normal">
                            {endpoint.addressCount} address{endpoint.addressCount === 1 ? "" : "es"}
                          </Badge>
                        </div>
                        <span className="truncate font-mono text-xs text-muted-foreground">{endpoint.url}</span>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      {blacklisted ? (
                        <BlacklistBadge endpoint={endpoint} />
                      ) : (
                        <>
                          <BlacklistBadge endpoint={endpoint} />
                          <StatusBadge status={endpoint.status} />
                          <span className="hidden text-xs text-muted-foreground sm:inline">
                            {endpoint.status === "connected"
                              ? `since ${formatRelativeTime(endpoint.lastConnectedAt)}`
                              : `since ${formatRelativeTime(endpoint.lastDisconnectedAt)}`}
                          </span>
                        </>
                      )}
                      <Switch
                        checked={endpoint.enabled}
                        disabled={isPending}
                        onCheckedChange={(checked) => handleToggleEnabled(endpoint, checked)}
                        aria-label="Enable endpoint"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending || isTesting || tester.progress !== null}
                        onClick={() => tester.testOne(endpoint, { enableOnSuccess: blacklisted })}
                        className="gap-1.5"
                      >
                        {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                        Test
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending || !endpoint.enabled || blacklisted}
                        onClick={() => handleReconnect(endpoint)}
                        className="gap-1.5"
                      >
                        <RefreshCw className="size-3.5" />
                        Reconnect
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={isPending} className="text-muted-foreground hover:text-negative">
                            <Trash2 className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this RPC endpoint?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {endpoint.addressCount > 0
                                ? `${endpoint.addressCount} address(es) currently on it will be redistributed to the remaining active endpoints within about 15 seconds.`
                                : "No addresses are currently assigned to it."}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-negative text-negative-foreground hover:bg-negative/90"
                              onClick={() => handleDelete(endpoint)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  {blacklisted && (
                    <p className="text-xs text-negative/90">
                      Blacklisted after {FAILURE_THRESHOLD} failed tests in a row - its addresses were moved to the other endpoints. Test it to bring
                      it back, or delete it.
                    </p>
                  )}
                  {endpoint.lastError && (
                    <p className="flex items-start gap-1.5 text-xs text-negative/90">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      {endpoint.lastError}
                    </p>
                  )}
                  <TestResultLine test={endpoint.lastTest} />

                  {isExpanded && (
                    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                      {addressesLoading ? (
                        <div className="flex flex-col gap-1.5">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-5 w-full" />
                          ))}
                        </div>
                      ) : !addresses || addresses.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No addresses assigned to this endpoint.</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {addresses.map((a) => (
                            <div key={a.address} className="flex min-w-0 items-center gap-1.5 text-xs">
                              <SubStatusDot status={a.subscriptionStatus} />
                              <span className="inline-flex shrink-0 items-center gap-1">
                    <span className="truncate font-mono text-muted-foreground">{formatAddress(a.address, 5)}</span>
                    <CopyButton value={a.address} />
                  </span>
                              {a.label ? <span className="min-w-0 truncate text-muted-foreground/70">({a.label})</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Separator />
      <HttpRpcSection ref={httpSectionRef} />
    </div>
  );
}
