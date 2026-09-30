"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Router,
  Trash2,
  Wifi,
  WifiOff,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addHttpRpcEndpoint,
  addRpcEndpoint,
  deleteHttpRpcEndpoint,
  deleteRpcEndpoint,
  getRpcEndpointAddresses,
  listHttpRpcEndpoints,
  listRpcEndpoints,
  reconnectRpcEndpoint,
  updateHttpRpcEndpoint,
  updateRpcEndpoint,
} from "@/lib/api";
import { formatAddress, formatRelativeTime } from "@/lib/format";
import type { HttpRpcEndpointView, RpcEndpointAddress, RpcEndpointView } from "@/lib/types";
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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!url.trim()) {
      toast.error("Enter an HTTP RPC URL");
      return;
    }
    setSubmitting(true);
    try {
      await addHttpRpcEndpoint(url.trim(), label.trim() || undefined);
      toast.success("HTTP RPC endpoint added");
      setUrl("");
      setLabel("");
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

function HttpRpcSection() {
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
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => {
                  const isPending = pendingId === endpoint._id;
                  return (
                    <TableRow key={endpoint._id} className="border-border/60">
                      <TableCell className="max-w-3xs sm:max-w-xs">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate font-medium">{endpoint.label || "Unlabeled endpoint"}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">{endpoint.url}</span>
                        </div>
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
  const endpointLabelByUrl = new Map((endpoints ?? []).map((e) => [e.url, e.label || formatAddress(e.url, 12)]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Router className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">RPC endpoints</h1>
            <p className="text-sm text-muted-foreground">
              Tracked addresses are spread across every active endpoint below, so no single provider&apos;s
              rate limit gets hit as hard.
            </p>
          </div>
        </div>
        <AddRpcDialog onAdded={refresh} />
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-muted-foreground">
          {endpoints?.length ?? 0} endpoint{(endpoints?.length ?? 0) === 1 ? "" : "s"}
        </div>
        <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-1.5 text-muted-foreground">
          {totalAddresses} address{totalAddresses === 1 ? "" : "es"} tracked
        </div>
        {unresolvedCount > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-negative/30 bg-negative/10 px-3 py-1.5 text-negative">
            <AlertTriangle className="size-3.5" />
            {unresolvedCount} address{unresolvedCount === 1 ? "" : "es"} not currently subscribed
          </div>
        )}
      </div>

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
                  <span className="shrink-0 truncate font-mono text-muted-foreground">{formatAddress(a.address, 5)}</span>
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
            return (
              <Card key={endpoint._id} className="border-border/60">
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
                      <StatusBadge status={endpoint.status} />
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {endpoint.status === "connected"
                          ? `since ${formatRelativeTime(endpoint.lastConnectedAt)}`
                          : `since ${formatRelativeTime(endpoint.lastDisconnectedAt)}`}
                      </span>
                      <Switch
                        checked={endpoint.enabled}
                        disabled={isPending}
                        onCheckedChange={(checked) => handleToggleEnabled(endpoint, checked)}
                        aria-label="Enable endpoint"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isPending || !endpoint.enabled}
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

                  {endpoint.lastError && (
                    <p className="flex items-start gap-1.5 text-xs text-negative/90">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      {endpoint.lastError}
                    </p>
                  )}

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
                              <span className="shrink-0 truncate font-mono text-muted-foreground">{formatAddress(a.address, 5)}</span>
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
      <HttpRpcSection />
    </div>
  );
}
