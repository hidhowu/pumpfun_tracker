"use client";

import { useCallback, useEffect, useImperativeHandle, useState, type Ref } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DialogIcon } from "@/components/ui/dialog-parts";
import { AddHttpRpcDialog } from "@/components/rpc/add-dialogs";
import { ConfirmDelete, HealthToolbar } from "@/components/rpc/health-toolbar";
import { BlacklistBadge, EmptyBox, isBlacklisted, StatusPill, TestResultLine } from "@/components/rpc/parts";
import { useRpcTester } from "@/components/rpc/use-rpc-tester";
import {
  deleteHttpRpcEndpoint,
  deleteHttpRpcEndpointsBulk,
  listHttpRpcEndpoints,
  updateHttpRpcEndpoint,
} from "@/lib/api";
import type { HttpRpcEndpointView } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scope = "both" | "backtest";

function ScopeSelect({ endpoint, disabled, onChange, className }: { endpoint: HttpRpcEndpointView; disabled: boolean; onChange: (scope: Scope) => void; className?: string }) {
  return (
    <Select value={endpoint.scope ?? "both"} disabled={disabled} onValueChange={(v) => onChange(v as Scope)}>
      <SelectTrigger size="sm" className={cn("w-[11.5rem]", className)} aria-label="Endpoint scope">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="both">Live + backtests</SelectItem>
        <SelectItem value="backtest">Backtests only</SelectItem>
      </SelectContent>
    </Select>
  );
}

function HealthCell({ endpoint }: { endpoint: HttpRpcEndpointView }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <BlacklistBadge endpoint={endpoint} />
      {endpoint.lastTest ? <TestResultLine test={endpoint.lastTest} /> : <span className="text-xs text-text-3">Not tested yet</span>}
    </div>
  );
}

export function HttpRpcSection({ ref }: { ref?: Ref<{ testAll: () => Promise<void> }> }) {
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

  async function handleScopeChange(endpoint: HttpRpcEndpointView, scope: Scope) {
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

  /** Test + delete buttons for one endpoint (the row's Actions cell on desktop, the card's button row on a phone). A function, not a component, so a refresh never remounts an open confirm. */
  function renderActions(endpoint: HttpRpcEndpointView, phone?: boolean) {
    const isPending = pendingId === endpoint._id;
    const isTesting = tester.testingIds.has(endpoint._id);
    return (
      <div className={cn("flex items-center gap-1.5", phone ? "w-full" : "justify-end")}>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending || isTesting || tester.progress !== null}
          onClick={() => tester.testOne(endpoint, { enableOnSuccess: isBlacklisted(endpoint) })}
          className={cn("gap-1.5", phone && "h-11 flex-1 text-[13px]")}
        >
          {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          Test
        </Button>
        <ConfirmDelete
          trigger={
            <Button variant={phone ? "outline" : "ghost"} size={phone ? "icon-lg" : "icon-sm"} disabled={isPending} aria-label="Delete endpoint" className={cn(!phone && "text-text-3 hover:text-negative", phone && "text-negative")}>
              <Trash2 className="size-4" />
            </Button>
          }
          title="Delete this HTTP RPC endpoint?"
          description="This can't be undone."
          onConfirm={() => handleDelete(endpoint)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DialogIcon>
            <Zap className="size-5" />
          </DialogIcon>
          <h2 className="text-[17px] leading-6 font-semibold">
            HTTP RPC endpoints (round-robin)
            <HelpTip>Used for every non-websocket call. Falls back to SOLANA_RPC_URLS from .env when empty.</HelpTip>
          </h2>
        </div>
        <div className="max-md:w-full">
          <AddHttpRpcDialog onAdded={refresh} />
        </div>
      </div>

      <HealthToolbar endpoints={endpoints ?? []} tester={tester} onDeleteMany={handleDeleteMany} />

      {loading && !endpoints ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : !endpoints || endpoints.length === 0 ? (
        <EmptyBox title="None configured - calls use .env's SOLANA_RPC_URLS only." className="min-h-[120px] py-6" />
      ) : (
        <>
          {/* Desktop: one table */}
          <div className="hidden overflow-hidden rounded-[20px] border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Endpoint</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Used for</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {endpoints.map((endpoint) => {
                  const isPending = pendingId === endpoint._id;
                  return (
                    <TableRow key={endpoint._id} className={cn(isBlacklisted(endpoint) && "bg-neg-soft hover:bg-neg-soft")}>
                      <TableCell className="max-w-3xs pl-5 sm:max-w-xs">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold">{endpoint.label || "Unlabeled endpoint"}</span>
                          <span className="truncate font-mono text-xs text-text-3">{endpoint.url}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-3xs whitespace-normal sm:max-w-xs">
                        <HealthCell endpoint={endpoint} />
                      </TableCell>
                      <TableCell>
                        <ScopeSelect endpoint={endpoint} disabled={isPending} onChange={(scope) => handleScopeChange(endpoint, scope)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <Switch checked={endpoint.enabled} disabled={isPending} onCheckedChange={(checked) => handleToggleEnabled(endpoint, checked)} aria-label="Enable endpoint" />
                        </div>
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        {renderActions(endpoint)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Phone: one card per endpoint */}
          <div className="flex flex-col gap-3 md:hidden">
            {endpoints.map((endpoint) => {
              const isPending = pendingId === endpoint._id;
              const blacklisted = isBlacklisted(endpoint);
              return (
                <article key={endpoint._id} className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border p-4", blacklisted ? "border-destructive/40 bg-neg-soft" : "border-border bg-card")}>
                  <div className="flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="truncate text-[15px] font-semibold">{endpoint.label || "Unlabeled endpoint"}</b>
                      <span className="truncate font-mono text-xs text-text-3">{endpoint.url}</span>
                    </div>
                    <Switch checked={endpoint.enabled} disabled={isPending} onCheckedChange={(checked) => handleToggleEnabled(endpoint, checked)} aria-label="Enable endpoint" />
                  </div>
                  {blacklisted ? (
                    <StatusPill tone="neg" className="self-start">
                      Blacklisted
                    </StatusPill>
                  ) : (
                    <BlacklistBadge endpoint={endpoint} />
                  )}
                  {endpoint.lastTest ? <TestResultLine test={endpoint.lastTest} /> : <span className="text-xs text-text-3">Not tested yet</span>}
                  <ScopeSelect endpoint={endpoint} disabled={isPending} onChange={(scope) => handleScopeChange(endpoint, scope)} className="h-11 w-full" />
                  {renderActions(endpoint, true)}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
