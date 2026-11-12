"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Router, Server, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogIcon } from "@/components/ui/dialog-parts";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AddRpcDialog } from "@/components/rpc/add-dialogs";
import { ConfirmDelete, HealthToolbar } from "@/components/rpc/health-toolbar";
import { HttpRpcSection } from "@/components/rpc/http-section";
import { AddressRow, BlacklistBadge, ConnectionBadge, EmptyBox, FAILURE_THRESHOLD, isBlacklisted, StatusPill, TestResultLine } from "@/components/rpc/parts";
import { useRpcTester } from "@/components/rpc/use-rpc-tester";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  deleteRpcEndpoint,
  deleteRpcEndpointsBulk,
  getRpcEndpointAddresses,
  listRpcEndpoints,
  reconnectRpcEndpoint,
  updateRpcEndpoint,
} from "@/lib/api";
import { formatAddress, formatRelativeTime } from "@/lib/format";
import type { RpcEndpointAddress, RpcEndpointView } from "@/lib/types";
import { cn } from "@/lib/utils";

function Tile({ label, value, hint, help }: { label: string; value: number; hint?: string; help?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3.5">
      <span className="text-xs text-text-3">
        {label}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </span>
      <b className="text-[24px] leading-8 font-semibold tracking-[-0.02em] tabular-nums">{value}</b>
      {hint ? <span className="text-xs text-text-3">{hint}</span> : null}
    </div>
  );
}

/** The summary chips from the desktop design: counts in a neutral pill, problems in a red one. */
function SummaryChip({ bad, children }: { bad?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] tabular-nums [&>svg]:size-3.5",
        bad ? "border-destructive/35 bg-neg-soft text-destructive" : "border-border bg-card text-text-2"
      )}
    >
      {children}
    </span>
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
  const [untrackedOpen, setUntrackedOpen] = useState(false);
  const wide = useMediaQuery("(min-width: 768px)");

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
  const endpointCount = endpoints?.length ?? 0;
  const untrackedShown = wide || untrackedOpen;

  /** Test / Reconnect / Delete for one endpoint. Functions rather than components so the 5 s refresh never remounts an open confirm. */
  function renderActions(endpoint: RpcEndpointView, phone: boolean) {
    const isPending = pendingId === endpoint._id;
    const isTesting = tester.testingIds.has(endpoint._id);
    const blacklisted = isBlacklisted(endpoint);
    const grow = phone ? "h-11 flex-1 text-[13px]" : "";
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending || isTesting || tester.progress !== null}
          onClick={() => tester.testOne(endpoint, { enableOnSuccess: blacklisted })}
          className={cn("gap-1.5", grow)}
        >
          {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          Test
        </Button>
        <Button variant="outline" size="sm" disabled={isPending || !endpoint.enabled || blacklisted} onClick={() => handleReconnect(endpoint)} className={cn("gap-1.5", grow)}>
          <RefreshCw className="size-3.5" />
          Reconnect
        </Button>
        <ConfirmDelete
          trigger={
            <Button
              variant={phone ? "outline" : "ghost"}
              size={phone ? "icon-lg" : "icon-sm"}
              disabled={isPending}
              aria-label="Delete endpoint"
              className={phone ? "text-negative" : "text-text-3 hover:text-negative"}
            >
              <Trash2 className="size-4" />
            </Button>
          }
          title="Delete this RPC endpoint?"
          description={
            endpoint.addressCount > 0
              ? `${endpoint.addressCount} address(es) currently on it will be redistributed to the remaining active endpoints within about 15 seconds.`
              : "No addresses are currently assigned to it."
          }
          onConfirm={() => handleDelete(endpoint)}
        />
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DialogIcon>
            <Server className="size-5" />
          </DialogIcon>
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px] md:tracking-[-0.025em]">
            RPC endpoints
            <HelpTip>Tracked addresses are spread across every active endpoint so no provider&apos;s rate limit is hit hard.</HelpTip>
          </h1>
        </div>
        <div className="flex items-center gap-2 max-md:hidden">
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

      {/* Summary: pills on desktop, two tiles + problem pills on a phone */}
      <div className="flex flex-wrap gap-2.5 max-md:hidden">
        <SummaryChip>
          {endpointCount} endpoint{endpointCount === 1 ? "" : "s"}
        </SummaryChip>
        <SummaryChip>
          {totalAddresses} address{totalAddresses === 1 ? "" : "es"} tracked
        </SummaryChip>
        {blacklistedCount > 0 && (
          <SummaryChip bad>
            <ShieldAlert />
            {blacklistedCount} blacklisted
          </SummaryChip>
        )}
        {unresolvedCount > 0 && (
          <SummaryChip bad>
            <AlertTriangle />
            {unresolvedCount} address{unresolvedCount === 1 ? "" : "es"} not currently subscribed
          </SummaryChip>
        )}
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Endpoints" value={endpointCount} />
          <Tile label="Addresses" value={totalAddresses} hint="tracked" />
        </div>
        {blacklistedCount > 0 || unresolvedCount > 0 ? (
          <div className="flex flex-wrap gap-2">
            {blacklistedCount > 0 && <StatusPill tone="neg">{blacklistedCount} blacklisted</StatusPill>}
            {unresolvedCount > 0 && <StatusPill tone="neg">{unresolvedCount} not subscribed</StatusPill>}
          </div>
        ) : null}
        <div className="flex gap-2.5">
          <AddRpcDialog onAdded={refresh} />
        </div>
      </div>

      <HealthToolbar endpoints={endpoints ?? []} tester={tester} onDeleteMany={handleDeleteMany} />
      <Button
        variant="outline"
        className="h-11 justify-center gap-1.5 md:hidden"
        disabled={testingEverything || tester.progress !== null}
        onClick={handleTestEverything}
        title="Tests every WebSocket and HTTP endpoint by fetching a known transaction (one success in up to 5 tries passes)"
      >
        {testingEverything ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        Test all RPC (WebSocket + HTTP)
      </Button>

      {unresolvedAddresses.length > 0 && (
        <section className="overflow-hidden rounded-[20px] border border-destructive/40 bg-neg-soft">
          <div className="flex min-h-[52px] items-center gap-2 px-4 py-3 md:pb-0">
            <button
              type="button"
              onClick={() => setUntrackedOpen((v) => !v)}
              aria-expanded={untrackedShown}
              disabled={wide}
              className="flex min-w-0 flex-col text-left disabled:cursor-default"
            >
              <b className="inline-flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="size-3.5" />
                Not currently tracked ({unresolvedAddresses.length})
              </b>
              <span className="text-xs text-text-3 md:hidden">pending / failed · resolves within ~15 s</span>
            </button>
            <HelpTip className="ml-0 self-start max-md:mt-0.5 md:self-center">
              &quot;pending&quot; means waiting on its endpoint (often mid-reconnect, or its subscribe call hasn&apos;t run yet), &quot;failed&quot; means an actual subscribe error (e.g. rate-limited). Both resolve on their own within about 15 seconds once the endpoint is healthy.
            </HelpTip>
            <button type="button" onClick={() => setUntrackedOpen((v) => !v)} aria-label={untrackedOpen ? "Hide addresses" : "Show addresses"} className="ml-auto flex size-9 items-center justify-center rounded-lg text-text-3 md:hidden">
              <ChevronDown className={cn("size-4 transition-transform", untrackedOpen && "rotate-180")} />
            </button>
          </div>
          {untrackedShown && (
            <div className="grid grid-cols-1 gap-2.5 px-4 pb-4 md:grid-cols-2 md:pt-3 xl:grid-cols-3">
              {unresolvedAddresses.map((a) => (
                <AddressRow key={a.address} address={a} endpoint={a.assignedRpcUrl ? (endpointLabelByUrl.get(a.assignedRpcUrl) ?? "unknown endpoint") : "unassigned"} />
              ))}
            </div>
          )}
        </section>
      )}

      {loading && !endpoints ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[20px]" />
          ))}
        </div>
      ) : !endpoints || endpoints.length === 0 ? (
        <EmptyBox icon={<Router className="size-6" />} title="No RPC endpoints configured yet." className="min-h-[240px]">
          <AddRpcDialog
            onAdded={refresh}
            trigger={
              <Button className="gap-1.5">
                <Plus className="size-4" />
                Add RPC
              </Button>
            }
          />
        </EmptyBox>
      ) : (
        <div className="flex flex-col gap-3">
          {endpoints.map((endpoint) => {
            const isPending = pendingId === endpoint._id;
            const isExpanded = expandedId === endpoint._id;
            const blacklisted = isBlacklisted(endpoint);
            const Chevron = isExpanded ? ChevronDown : ChevronRight;
            const since = endpoint.status === "connected" ? endpoint.lastConnectedAt : endpoint.lastDisconnectedAt;
            const addressCount = `${endpoint.addressCount} address${endpoint.addressCount === 1 ? "" : "es"}`;
            return (
              <article
                key={endpoint._id}
                className={cn("flex min-w-0 flex-col gap-3 rounded-[20px] border p-4 md:p-5", blacklisted ? "border-destructive/40 bg-neg-soft" : "border-border bg-card")}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => toggleExpand(endpoint)} aria-expanded={isExpanded} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-text-2">
                      <Chevron className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <b className="truncate text-[15px] font-semibold">{endpoint.label || "Unlabeled endpoint"}</b>
                        <StatusPill className="font-normal">{addressCount}</StatusPill>
                      </span>
                      <span className="truncate font-mono text-xs text-text-3">{endpoint.url}</span>
                    </span>
                  </button>

                  {/* Desktop: everything in one right-hand cluster */}
                  <div className="flex flex-wrap items-center gap-2 max-md:hidden">
                    <BlacklistBadge endpoint={endpoint} />
                    {!blacklisted && (
                      <>
                        <ConnectionBadge status={endpoint.status} />
                        <span className="text-xs text-text-3">since {formatRelativeTime(since)}</span>
                      </>
                    )}
                    <Switch checked={endpoint.enabled} disabled={isPending} onCheckedChange={(checked) => handleToggleEnabled(endpoint, checked)} aria-label="Enable endpoint" />
                    {renderActions(endpoint, false)}
                  </div>
                  <Switch
                    className="md:hidden"
                    checked={endpoint.enabled}
                    disabled={isPending}
                    onCheckedChange={(checked) => handleToggleEnabled(endpoint, checked)}
                    aria-label="Enable endpoint"
                  />
                </div>

                {/* Phone: badges under the name */}
                <div className="flex flex-wrap items-center gap-2 md:hidden">
                  <BlacklistBadge endpoint={endpoint} />
                  {!blacklisted && (
                    <>
                      <ConnectionBadge status={endpoint.status} />
                      <span className="text-xs text-text-3">since {formatRelativeTime(since)}</span>
                    </>
                  )}
                </div>

                {blacklisted && (
                  <p className="text-xs leading-[18px] text-destructive">
                    Blacklisted after {FAILURE_THRESHOLD} failed tests in a row - its addresses were moved to the other endpoints. Test it to bring it back, or delete it.
                  </p>
                )}
                {endpoint.lastError && (
                  <p className="flex items-start gap-1.5 text-xs leading-[18px] text-destructive">
                    <AlertTriangle className="mt-[3px] size-3 shrink-0" />
                    <span className="min-w-0 break-words">{endpoint.lastError}</span>
                  </p>
                )}
                <TestResultLine test={endpoint.lastTest} />

                {isExpanded && (
                  <div className="rounded-2xl border border-border bg-surface-2 px-3.5 py-3">
                    {addressesLoading ? (
                      <div className="flex flex-col gap-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-5 w-full" />
                        ))}
                      </div>
                    ) : !addresses || addresses.length === 0 ? (
                      <p className="text-xs text-text-3">No addresses assigned to this endpoint.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                        {addresses.map((a) => (
                          <AddressRow key={a.address} address={a} />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 md:hidden">{renderActions(endpoint, true)}</div>
              </article>
            );
          })}
        </div>
      )}

      <div className="h-px bg-border" />
      <HttpRpcSection ref={httpSectionRef} />
    </div>
  );
}
