"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, EllipsisVertical, Loader2, Plus, RefreshCw, ShieldAlert, Shuffle, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogIcon } from "@/components/ui/dialog-parts";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AddProxiesDialog } from "@/components/proxies/add-proxies-dialog";
import { ConfirmDelete } from "@/components/rpc/health-toolbar";
import { EmptyBox, StatusPill } from "@/components/rpc/parts";
import { deleteProxiesBulk, deleteProxy, listProxies, testProxy, updateProxy } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import type { ProxyView } from "@/lib/types";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: ProxyView["status"] }) {
  if (status === "blacklisted") {
    return (
      <StatusPill tone="neg">
        <ShieldAlert /> Blacklisted
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="pos">
      <CheckCircle2 /> Active
    </StatusPill>
  );
}

const plural = (n: number) => `prox${n === 1 ? "y" : "ies"}`;

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<ProxyView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deletingInactive, setDeletingInactive] = useState(false);
  const [confirmInactive, setConfirmInactive] = useState(false);
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

  const blacklistedCount = useMemo(() => (proxies ?? []).filter((p) => p.status === "blacklisted").length, [proxies]);
  const inactiveProxies = useMemo(() => (proxies ?? []).filter((p) => p.status === "blacklisted" || !p.enabled), [proxies]);

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

  /** Deletes every blacklisted or disabled proxy in one call - no need to tick or delete them one by one. */
  async function handleDeleteInactive() {
    const ids = inactiveProxies.map((p) => p._id);
    if (ids.length === 0 || deletingInactive) return;
    setDeletingInactive(true);
    try {
      await deleteProxiesBulk(ids);
      toast.success(`${ids.length} blacklisted/disabled prox${ids.length === 1 ? "y" : "ies"} deleted`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingInactive(false);
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

  const total = proxies?.length ?? 0;
  const allSelected = total > 0 && selected.size === total;
  const busy = !!bulkTest;

  /** Test + delete for one proxy. A function, not a component, so the 10 s refresh never remounts an open confirm. */
  function renderActions(proxy: ProxyView, phone: boolean) {
    const isPending = pendingId === proxy._id;
    const isTesting = testingId === proxy._id;
    return (
      <>
        <Button variant="outline" size="sm" disabled={isTesting || busy} onClick={() => handleTest(proxy)} className={cn("gap-1.5", phone && "h-11 flex-1 text-[13px]")}>
          {isTesting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
          Test
        </Button>
        <ConfirmDelete
          trigger={
            <Button
              variant={phone ? "outline" : "ghost"}
              size={phone ? "icon-lg" : "icon-sm"}
              disabled={isPending}
              aria-label="Delete proxy"
              className={phone ? "text-negative" : "text-text-3 hover:text-negative"}
            >
              <Trash2 className="size-4" />
            </Button>
          }
          title="Delete this proxy?"
          description="This can't be undone."
          onConfirm={() => handleDelete(proxy)}
        />
      </>
    );
  }

  /** What a proxy row says about its last failure: the message (full text in a tooltip, since a raw curl error can be long). */
  function renderError(proxy: ProxyView, className?: string) {
    if (!proxy.lastError) return null;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("block truncate text-xs text-destructive", className)}>{proxy.lastError}</span>
        </TooltipTrigger>
        <TooltipContent className="break-words">{proxy.lastError}</TooltipContent>
      </Tooltip>
    );
  }

  const testingPill = bulkTest ? (
    <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-[13px] text-text-2 tabular-nums">
      <Loader2 className="size-3.5 animate-spin" />
      Testing {bulkTest.done}/{bulkTest.total} · {bulkTest.passed} working
    </span>
  ) : null;
  const stopButton = (
    <Button variant="outline" size="sm" className="gap-1.5 max-md:h-11" onClick={() => (cancelBulkTest.current = true)}>
      <Square className="size-3.5" /> Stop
    </Button>
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DialogIcon>
            <Shuffle className="size-5" />
          </DialogIcon>
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px] md:tracking-[-0.025em]">
            Proxies
            <HelpTip>Rotated round-robin by the pump.fun API client to spread requests across more than one origin IP. A proxy that fails 3 times in a row is auto-blacklisted and skipped until it passes a test again.</HelpTip>
          </h1>
        </div>
        <div className="max-md:hidden">
          <AddProxiesDialog onAdded={refresh} />
        </div>
      </div>
      <div className="md:hidden">
        <AddProxiesDialog onAdded={refresh} />
      </div>

      {/* Desktop toolbar: counts, then the bulk buttons in their original order */}
      <div className="flex flex-wrap items-center gap-2.5 max-md:hidden">
        <span className="inline-flex items-center rounded-xl border border-border bg-card px-3 py-1.5 text-[13px] text-text-2 tabular-nums">
          {total} {plural(total)}
        </span>
        {blacklistedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/35 bg-neg-soft px-3 py-1.5 text-[13px] text-destructive tabular-nums">
            <AlertTriangle className="size-3.5" />
            {blacklistedCount} blacklisted
          </span>
        )}
        {bulkTest ? (
          <>
            {testingPill}
            {stopButton}
          </>
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
              variant="outline"
              size="sm"
              className="gap-1.5 text-negative hover:text-negative"
              disabled={inactiveProxies.length === 0 || deletingInactive}
              onClick={() => setConfirmInactive(true)}
              title="Deletes every blacklisted or disabled proxy at once"
            >
              {deletingInactive ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Delete blacklisted &amp; disabled ({inactiveProxies.length})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              disabled={total === 0}
              onClick={() => runBulkTest(proxies ?? [], { enableOnSuccess: false })}
              title="Tests every proxy - working ones are un-blacklisted, failing ones count toward blacklisting. Enabled/disabled switches are left as they are."
            >
              <CheckCircle2 className="size-3.5" />
              Test all
            </Button>
          </>
        )}
        {selected.size > 0 && (
          <ConfirmDelete
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5 text-negative hover:text-negative">
                <Trash2 className="size-3.5" />
                Delete {selected.size} selected
              </Button>
            }
            title={`Delete ${selected.size} ${plural(selected.size)}?`}
            description="This can't be undone."
            onConfirm={handleBulkDelete}
          />
        )}
      </div>

      {/* Phone toolbar: counts, Re-test with the rest behind a menu, and the selection bar */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex flex-wrap gap-2">
          <StatusPill>
            {total} {plural(total)}
          </StatusPill>
          {blacklistedCount > 0 && <StatusPill tone="neg">{blacklistedCount} blacklisted</StatusPill>}
        </div>
        {bulkTest ? (
          <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-surface-2 px-3.5 py-2.5">
            <span className="min-w-0 flex-1 text-sm tabular-nums">
              Testing {bulkTest.done}/{bulkTest.total} — {bulkTest.passed} working
            </span>
            {stopButton}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-11 min-w-0 flex-1 gap-1.5 text-[13px]"
              disabled={inactiveProxies.length === 0}
              onClick={() => runBulkTest(inactiveProxies, { enableOnSuccess: true })}
            >
              <RefreshCw className="size-3.5 shrink-0" />
              <span className="truncate">Re-test blacklisted &amp; disabled ({inactiveProxies.length})</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-lg" aria-label="More bulk actions">
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem className="min-h-11 text-negative" disabled={inactiveProxies.length === 0 || deletingInactive} onSelect={() => setConfirmInactive(true)}>
                  <Trash2 /> Delete blacklisted &amp; disabled ({inactiveProxies.length})
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={total === 0} onSelect={() => runBulkTest(proxies ?? [], { enableOnSuccess: false })}>
                  <CheckCircle2 /> Test all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {selected.size > 0 && (
          <div role="region" aria-label="Selected proxies" className="flex flex-wrap items-center gap-2 rounded-2xl border border-volt-line bg-volt-soft px-3.5 py-2.5">
            <b className="text-[13px] text-primary">{selected.size} selected</b>
            <div className="flex-1" />
            <ConfirmDelete
              trigger={
                <Button variant="outline" size="sm" className="gap-1.5 text-negative hover:text-negative">
                  <Trash2 className="size-3.5" />
                  Delete {selected.size} selected
                </Button>
              }
              title={`Delete ${selected.size} ${plural(selected.size)}?`}
              description="This can't be undone."
              onConfirm={handleBulkDelete}
            />
          </div>
        )}
      </div>

      <ConfirmDelete
        open={confirmInactive}
        onOpenChange={setConfirmInactive}
        title={`Delete ${inactiveProxies.length} ${plural(inactiveProxies.length)}?`}
        description="Every blacklisted or disabled proxy is deleted. Active proxies are not touched. This can't be undone."
        confirmLabel={`Delete ${inactiveProxies.length}`}
        onConfirm={handleDeleteInactive}
      />

      {loading && !proxies ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-2xl" />
          ))}
        </div>
      ) : !proxies || proxies.length === 0 ? (
        <EmptyBox icon={<Shuffle className="size-6" />} title="No proxies configured yet - the API client calls directly." className="min-h-[240px]">
          <AddProxiesDialog
            onAdded={refresh}
            trigger={
              <Button className="gap-1.5">
                <Plus className="size-4" />
                Add proxies
              </Button>
            }
          />
        </EmptyBox>
      ) : (
        <>
          {/* Desktop: one table */}
          <div className="hidden overflow-hidden rounded-[20px] border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-11 pl-4">
                    <Checkbox
                      checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                      onCheckedChange={(checked) => setSelected(checked === true ? new Set(proxies.map((p) => p._id)) : new Set())}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Proxy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Failures</TableHead>
                  <TableHead className="text-right">Last checked</TableHead>
                  <TableHead className="text-center">Enabled</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proxies.map((proxy) => {
                  const isPending = pendingId === proxy._id;
                  const isSelected = selected.has(proxy._id);
                  return (
                    <TableRow key={proxy._id} data-state={isSelected ? "selected" : undefined} className={cn(isSelected && "bg-[#222e19] hover:bg-[#222e19]")}>
                      <TableCell className="pl-4">
                        <Checkbox checked={isSelected} onCheckedChange={(checked) => toggleRow(proxy._id, checked === true)} aria-label={`Select ${proxy.url}`} />
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
                          {proxy.label ? <span className="truncate text-xs text-text-3">{proxy.label}</span> : null}
                          {renderError(proxy)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={proxy.status} />
                      </TableCell>
                      <TableCell className={cn("text-right text-sm tabular-nums", proxy.consecutiveFailures > 0 ? "text-negative" : "text-text-3")}>{proxy.consecutiveFailures}</TableCell>
                      <TableCell className="text-right text-xs text-text-3">{formatRelativeTime(proxy.lastCheckedAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-center">
                          <Switch checked={proxy.enabled} disabled={isPending} onCheckedChange={(checked) => handleToggleEnabled(proxy, checked)} aria-label="Enable proxy" />
                        </div>
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">{renderActions(proxy, false)}</div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Phone: one card per proxy */}
          <div className="flex flex-col gap-3 md:hidden">
            {proxies.map((proxy) => {
              const isPending = pendingId === proxy._id;
              const isSelected = selected.has(proxy._id);
              return (
                <article key={proxy._id} className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border p-4", isSelected ? "border-volt-line bg-volt-soft" : "border-border bg-card")}>
                  <div className="flex items-start gap-3">
                    <Checkbox className="mt-0.5" checked={isSelected} onCheckedChange={(checked) => toggleRow(proxy._id, checked === true)} aria-label={`Select ${proxy.url}`} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-mono text-xs">{proxy.url}</span>
                      {proxy.label ? <span className="truncate text-xs text-text-3">{proxy.label}</span> : null}
                      {proxy.lastError ? <span className="line-clamp-2 text-xs break-all text-destructive">{proxy.lastError}</span> : null}
                    </div>
                    <Switch checked={proxy.enabled} disabled={isPending} onCheckedChange={(checked) => handleToggleEnabled(proxy, checked)} aria-label="Enable proxy" />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <StatusBadge status={proxy.status} />
                    <span className="text-text-3 tabular-nums">
                      failures <b className={cn("font-semibold", proxy.consecutiveFailures > 0 ? "text-negative" : "text-text-2")}>{proxy.consecutiveFailures}</b> · {formatRelativeTime(proxy.lastCheckedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">{renderActions(proxy, true)}</div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
