"use client";

import { CopyButton } from "@/components/copy-button";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, Download, EllipsisVertical, FileDown, FlaskConical, ListPlus, Loader2, ListChecks, Pencil, Search, ShieldBan, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { addressListExportUrl, deleteBacktestAddressesBatched, getMatchingBacktestAddresses, importTradersToBacktest, listBacktestAddresses, updateBacktestAddress } from "@/lib/backtest-api";
import { listTraderLists } from "@/lib/api";
import { formatAddress } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { BacktestAddressesPage, BacktestAddressView } from "@/lib/backtest-types";
import type { TraderListView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AddAddressesDialog } from "./add-addresses-dialog";
import { BlacklistDialog } from "./blacklist-dialog";
import { NewRunDialog } from "./new-run-dialog";
import { RangeSelect } from "./range-select";
import { AddToBacktestDialog } from "./add-to-backtest-dialog";
import { Pill, formatDate } from "./shared";
import { useRouter } from "next/navigation";

const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

function EditLabelDialog({ entry, onClose, onSaved }: { entry: BacktestAddressView | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {/* Mounted only while open, so the field starts from this address's own label every time. */}
        {entry ? <EditLabelForm entry={entry} onClose={onClose} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditLabelForm({ entry, onClose, onSaved }: { entry: BacktestAddressView; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(entry.label);
  const [saving, setSaving] = useState(false);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      await updateBacktestAddress(entry.address, { label: label.trim() });
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-4">
      <DialogHeader className="flex-row items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-primary">
          <Tag className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <DialogTitle>Edit label</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{entry.address}</DialogDescription>
        </div>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bt-label">Label</Label>
        <Input id="bt-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus className="max-md:h-11" />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

const PAGE_SIZES = [25, 50, 100, 200];

/** "API" / "Address": whether the address has a pump.fun user ID (both read fast; the ID gives the endpoint a second identifier to try). */
function SourcePill({ userId }: { userId?: string | null }) {
  return userId ? (
    <span title="Has a pump.fun user ID - trades are read from pump.fun directly (fast)">
      <Pill tone="pos">API</Pill>
    </span>
  ) : (
    <span title="No pump.fun user ID - the wallet address is used in its place (also fast). Add the address again with its user ID to give the endpoint a second identifier to try.">
      <Pill tone="warn">Address</Pill>
    </span>
  );
}

function LivePill({ status }: { status: BacktestAddressView["liveStatus"] }) {
  if (status === "active") return <Pill tone="pos">Tracked</Pill>;
  if (status === "blacklisted") return <Pill tone="neg">Blacklisted</Pill>;
  return <span className="text-text-3">—</span>;
}

/**
 * The backtest list: add / import / label / remove addresses, then pick some and start a backtest on them. The list can hold tens of
 * thousands of addresses, so it is read a page at a time and searched on the server.
 */
export function AddressesTab() {
  const router = useRouter();
  const phone = !useMediaQuery("(min-width: 768px)");
  const [data, setData] = useState<BacktestAddressesPage | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState(""); // the search once typing has paused
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const latest = useRef(0);
  const [lists, setLists] = useState<TraderListView[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [addToOpen, setAddToOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const [editing, setEditing] = useState<BacktestAddressView | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);

  // Searching waits for a pause in typing before asking the server.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    try {
      const res = await listBacktestAddresses({ page, limit: pageSize, search: appliedSearch });
      if (mine !== latest.current) return; // a newer request has been made since
      setData(res);
      if (res.page > res.totalPages) setPage(res.totalPages); // the last page emptied out (rows removed)
    } catch (e) {
      if (mine === latest.current) toast.error(e instanceof Error ? e.message : "Failed to load the backtest list");
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [page, pageSize, appliedSearch]);

  useEffect(() => {
    const timer = setTimeout(refresh, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    listTraderLists()
      .then(({ lists }) => setLists(lists))
      .catch(() => {});
  }, []);

  const visible: BacktestAddressView[] = data?.addresses ?? [];
  const total = data?.total ?? 0;
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.address));
  const someVisibleSelected = visible.some((a) => selected.has(a.address));
  const canSelectAllMatching = allVisibleSelected && total > visible.length && selected.size < total;
  const selectedList = useMemo(() => [...selected], [selected]);

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((a) => next.delete(a.address));
      else visible.forEach((a) => next.add(a.address));
      return next;
    });
  }

  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const matching = await getMatchingBacktestAddresses(appliedSearch);
      setSelected((prev) => new Set([...prev, ...matching]));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to select the addresses");
    } finally {
      setSelectingAll(false);
    }
  }

  function toggleOne(address: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  }

  async function handleImport(listId?: string) {
    setImporting(true);
    setImportProgress(null);
    try {
      const { added, skipped, blacklisted = [] } = await importTradersToBacktest(listId, (done, total) => setImportProgress({ done, total }));
      toast.success(`${added.length} added${skipped.length ? `, ${skipped.length} already on the list` : ""}${blacklisted.length ? `, ${blacklisted.length} blacklisted (not added)` : ""}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
      refresh(); // some pages may have gone through
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteProgress({ done: 0, total: selected.size });
    try {
      const { deletedCount } = await deleteBacktestAddressesBatched(selectedList, (done, total) => setDeleteProgress({ done, total }));
      toast.success(`Removed ${deletedCount} address${deletedCount === 1 ? "" : "es"} from the backtest list`);
      setSelected(new Set());
      setConfirmDelete(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
      refresh(); // some batches may have gone through before it failed
    } finally {
      setDeleting(false);
      setDeleteProgress(null);
    }
  }

  const importLabel = importing && importProgress ? `Importing ${importProgress.done.toLocaleString()} / ${importProgress.total.toLocaleString()}` : "Import from Traders";

  /** The "copy live traders here" choices - a dropdown on wide screens, part of the ⋯ menu on phones. */
  const importItems = (
    <>
      <DropdownMenuLabel>Copy live traders here</DropdownMenuLabel>
      <DropdownMenuItem className="min-h-10 justify-between" onSelect={() => handleImport()}>
        All active traders
      </DropdownMenuItem>
      {lists.length > 0 && <DropdownMenuSeparator />}
      {lists.map((l) => (
        <DropdownMenuItem key={l._id} className="min-h-10 justify-between" onSelect={() => handleImport(l._id)}>
          <span className="truncate">List: {l.name}</span>
          <span className="text-xs text-text-3">{l.memberCount}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
  const exportItems = (
    <>
      <DropdownMenuLabel>{appliedSearch.trim() ? "The addresses matching your search" : "The whole backtest list"}</DropdownMenuLabel>
      <DropdownMenuItem asChild className="min-h-10">
        <a href={addressListExportUrl(appliedSearch, "addresses")} download>
          Addresses only
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-10">
        <a href={addressListExportUrl(appliedSearch, "full")} download>
          With label, user ID and date added
        </a>
      </DropdownMenuItem>
    </>
  );
  const hasList = data !== null && data.totalAll > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:max-w-[320px] md:flex-none md:basis-[320px] md:rounded-[10px]">
          <Search className="size-4 shrink-0" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address or label" aria-label="Search address or label" className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]" />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
              <X className="size-3.5" />
            </button>
          ) : null}
        </label>
        <div className="hidden flex-1 md:block" />
        {/* Wide screens: the two menus and the add button. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-1.5 max-md:hidden" disabled={importing}>
              {importing ? <Loader2 className="animate-spin" /> : <Download />}
              {importLabel}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 w-60 overflow-y-auto">
            {importItems}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-1.5 max-md:hidden" disabled={!hasList}>
              <FileDown />
              Export CSV
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {exportItems}
          </DropdownMenuContent>
        </DropdownMenu>
        <AddAddressesDialog
          triggerClassName="max-md:hidden"
          onAdded={() => {
            setPage(1);
            refresh();
          }}
        />
        {/* Phone: import and export live behind one ⋯ button. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-lg" aria-label="Import and export" className="h-12 w-12 md:hidden" disabled={importing}>
              {importing ? <Loader2 className="animate-spin" /> : <EllipsisVertical />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
            {importItems}
            <DropdownMenuSeparator />
            {exportItems}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="md:hidden">
        <AddAddressesDialog
          triggerClassName="h-12 w-full"
          onAdded={() => {
            setPage(1);
            refresh();
          }}
        />
      </div>
      {importing && importProgress && <p className="text-xs text-text-3 md:hidden">{importLabel}</p>}

      {hasList && <RangeSelect total={total} search={appliedSearch} onSelect={(addresses) => setSelected(new Set(addresses))} />}

      {canSelectAllMatching && (
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-volt-line bg-volt-soft px-3.5 py-2.5 text-[13px]">
          <span>All {visible.length} on this page are selected.</span>
          <Button size="sm" variant="outline" disabled={selectingAll} onClick={selectAllMatching}>
            {selectingAll && <Loader2 className="animate-spin" />}
            Select all {total.toLocaleString()} {appliedSearch.trim() ? "that match" : "on the list"}
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-volt-line bg-volt-soft px-3.5 py-2.5 max-md:sticky max-md:bottom-[84px] max-md:z-20 max-md:bg-surface-3">
          <b className="text-[13px] font-semibold text-primary">{selected.size.toLocaleString()} selected</b>
          <span className="flex-1" />
          <Button size="sm" className="gap-1.5 max-md:h-10" onClick={() => setRunDialogOpen(true)}>
            <FlaskConical /> Start backtest
          </Button>
          {/* Wide screens: the rest as buttons. */}
          <Button size="sm" variant="outline" className="gap-1.5 max-md:hidden" onClick={() => setAddToOpen(true)}>
            <ListPlus /> Add to a backtest
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative max-md:hidden" onClick={() => setBlacklistOpen(true)}>
            <ShieldBan /> Blacklist
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative max-md:hidden" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Remove
          </Button>
          <Button size="sm" variant="ghost" className="max-md:hidden" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {/* Phone: the same in a menu. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-lg" variant="outline" aria-label="More actions" className="md:hidden">
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem className="min-h-10 gap-2.5" onSelect={() => setAddToOpen(true)}>
                <ListPlus className="size-4" /> Add to a backtest
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-10 gap-2.5" onSelect={() => setBlacklistOpen(true)}>
                <ShieldBan className="size-4" /> Blacklist
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" className="min-h-10 gap-2.5" onSelect={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" /> Remove
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-10 gap-2.5" onSelect={() => setSelected(new Set())}>
                <X className="size-4" /> Clear
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {data === null ? (
        <div className="flex flex-col gap-2.5 rounded-[20px] border border-border bg-card p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : data.totalAll === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-3.5 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-12 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <ListChecks className="size-6" />
          </span>
          <b className="text-[15px] font-semibold">No addresses yet</b>
          <span className="max-w-[420px] text-[13px] text-text-2">Add some, or copy your live traders over.</span>
          <div className="flex flex-wrap justify-center gap-2">
            <AddAddressesDialog
              onAdded={() => {
                setPage(1);
                refresh();
              }}
            />
            <Button variant="outline" disabled={importing} onClick={() => handleImport()}>
              {importing ? <Loader2 className="animate-spin" /> : null}
              Import from Traders
            </Button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center">
          <b className="text-sm font-semibold">No address matches “{appliedSearch}”.</b>
          <Button variant="outline" size="sm" onClick={() => setSearch("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <>
          {/* Phone: one card per address. */}
          <div className={cn("flex flex-col gap-3 md:hidden", loading && "opacity-70")}>
            <label className="flex min-h-10 items-center gap-2.5 px-1 text-[13px] text-text-2">
              <Checkbox checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all on this page" />
              Select this page
            </label>
            {visible.map((a) => (
              <article key={a.address} className={cn("flex items-start gap-3 rounded-[20px] border bg-card p-4", selected.has(a.address) ? "border-volt-line bg-volt-soft" : "border-border")}>
                <Checkbox className="mt-1" checked={selected.has(a.address)} onCheckedChange={() => toggleOne(a.address)} aria-label={`Select ${a.address}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className={cn("text-[14px] font-semibold", !a.label && "font-normal text-text-3")}>{a.label || "Unlabeled"}</b>
                    <SourcePill userId={a.userId} />
                    {a.liveStatus ? <LivePill status={a.liveStatus} /> : null}
                  </span>
                  <span className="flex items-center gap-1 font-mono text-xs text-text-3">
                    {formatAddress(a.address, 8)}
                    <CopyButton value={a.address} />
                  </span>
                  <span className="text-xs text-text-3">
                    {a.cachedFrom && a.cachedTo ? `Cached ${formatDate(a.cachedFrom)} – ${formatDate(a.cachedTo)}` : "No history cached"} · in {a.runCount} backtest{a.runCount === 1 ? "" : "s"}
                  </span>
                </div>
                <Button variant="outline" size="icon-lg" aria-label="Edit label" onClick={() => setEditing(a)}>
                  <Pencil />
                </Button>
              </article>
            ))}
          </div>

          {/* Wide screens: the table. */}
          <div className={cn("overflow-hidden rounded-[20px] border border-border bg-card max-md:hidden", loading && "opacity-70 transition-opacity")}>
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="w-11 pl-4">
                    <Checkbox checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all on this page" />
                  </TableHead>
                  <TableHead className={headCls}>Address</TableHead>
                  <TableHead className={headCls}>History cached</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Backtests</TableHead>
                  <TableHead className={headCls}>Live</TableHead>
                  <TableHead className="w-14 pr-4">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((a) => (
                  <TableRow key={a.address} className="h-[68px] border-border" data-state={selected.has(a.address) ? "selected" : undefined}>
                    <TableCell className="pl-4">
                      <Checkbox checked={selected.has(a.address)} onCheckedChange={() => toggleOne(a.address)} aria-label={`Select ${a.address}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <b className={cn("truncate text-[13px] font-semibold", !a.label && "font-normal text-text-3")}>{a.label || "Unlabeled"}</b>
                          <SourcePill userId={a.userId} />
                        </span>
                        <span className="flex min-w-0 items-center gap-1 font-mono text-xs text-text-3">
                          <span className="truncate" title={a.address}>
                            {a.address}
                          </span>
                          <CopyButton value={a.address} />
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] text-text-2">{a.cachedFrom && a.cachedTo ? `${formatDate(a.cachedFrom)} – ${formatDate(a.cachedTo)}` : "—"}</TableCell>
                    <TableCell className="text-right text-[13px] tabular-nums">{a.runCount}</TableCell>
                    <TableCell>
                      <LivePill status={a.liveStatus} />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(a)} aria-label="Edit label" className="text-text-2">
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {hasList && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-3">
          <span className="flex items-center gap-1.5">
            {loading && <Loader2 className="size-3 animate-spin" />}
            {total === 0
              ? "No matches"
              : `${((data.page - 1) * data.pageSize + 1).toLocaleString()}–${Math.min(total, data.page * data.pageSize).toLocaleString()} of ${total.toLocaleString()}${
                  appliedSearch.trim() ? ` matching (${data.totalAll.toLocaleString()} on the list)` : ""
                }`}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {PAGE_SIZES.map((n) => (
              <Button
                key={n}
                size="sm"
                variant={pageSize === n ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setPageSize(n);
                  setPage(1);
                }}
              >
                {n}
              </Button>
            ))}
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 max-md:h-10" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 px-2.5 max-md:h-10" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <EditLabelDialog entry={editing} onClose={() => setEditing(null)} onSaved={refresh} />

      <NewRunDialog open={runDialogOpen} onOpenChange={setRunDialogOpen} selected={selectedList} allCount={data?.totalAll ?? 0} onCreated={(id) => router.push(`/backtest/${id}`)} />

      <AddToBacktestDialog addresses={selectedList} open={addToOpen} onOpenChange={setAddToOpen} onDone={() => router.refresh()} />

      <BlacklistDialog
        open={blacklistOpen}
        onOpenChange={setBlacklistOpen}
        addresses={selectedList}
        onDone={() => {
          setSelected(new Set());
          refresh();
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleting && setConfirmDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selected.size.toLocaleString()} address{selected.size === 1 ? "" : "es"}?
            </AlertDialogTitle>
            <AlertDialogDescription>They leave the backtest list only. Past backtests keep their results, cached history stays, and live Traders are untouched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // stay open to show the progress; handleDelete closes it when done
                handleDelete();
              }}
            >
              {deleting && <Loader2 className="animate-spin" />}
              {deleting && deleteProgress ? `Removing ${deleteProgress.done.toLocaleString()} / ${deleteProgress.total.toLocaleString()}` : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
