"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, Download, FlaskConical, Loader2, Pencil, Search, ShieldBan, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteBacktestAddressesBatched, getMatchingBacktestAddresses, importTradersToBacktest, listBacktestAddresses, updateBacktestAddress } from "@/lib/backtest-api";
import { listTraderLists } from "@/lib/api";
import { formatAddress } from "@/lib/format";
import type { BacktestAddressesPage, BacktestAddressView } from "@/lib/backtest-types";
import type { TraderListView } from "@/lib/types";
import { AddAddressesDialog } from "./add-addresses-dialog";
import { BlacklistDialog } from "./blacklist-dialog";
import { NewRunDialog } from "./new-run-dialog";
import { RangeSelect } from "./range-select";
import { formatDate } from "./shared";
import { useRouter } from "next/navigation";

function EditLabelDialog({ entry, onClose, onSaved }: { entry: BacktestAddressView | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry) setLabel(entry.label);
  }, [entry]);

  async function save() {
    if (!entry) return;
    setSaving(true);
    try {
      await updateBacktestAddress(entry.address, { label: label.trim() });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit label</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{entry?.address}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bt-label">Label</Label>
          <Input id="bt-label" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} autoFocus />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PAGE_SIZES = [25, 50, 100, 200];

/**
 * The backtest list: add / import / label / remove addresses, then pick some and start a backtest on them. The list can hold tens of
 * thousands of addresses, so it is read a page at a time and searched on the server.
 */
export function AddressesTab() {
  const router = useRouter();
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
    try {
      const { added, skipped, blacklisted = [] } = await importTradersToBacktest(listId);
      toast.success(`${added.length} added${skipped.length ? `, ${skipped.length} already on the list` : ""}${blacklisted.length ? `, ${blacklisted.length} blacklisted (not added)` : ""}`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search address or label" className="pl-8" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-1.5" disabled={importing}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Import from Traders
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Copy live traders here</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => handleImport()}>All active traders</DropdownMenuItem>
            {lists.length > 0 && <DropdownMenuSeparator />}
            {lists.map((l) => (
              <DropdownMenuItem key={l._id} onSelect={() => handleImport(l._id)}>
                List: {l.name} ({l.memberCount})
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <AddAddressesDialog
          onAdded={() => {
            setPage(1);
            refresh();
          }}
        />
      </div>

      {data !== null && data.totalAll > 0 && <RangeSelect total={total} search={appliedSearch} onSelect={(addresses) => setSelected(new Set(addresses))} />}

      {canSelectAllMatching && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span>All {visible.length} on this page are selected.</span>
          <Button size="sm" variant="outline" disabled={selectingAll} onClick={selectAllMatching}>
            {selectingAll && <Loader2 className="size-4 animate-spin" />}
            Select all {total.toLocaleString()} {appliedSearch.trim() ? "that match" : "on the list"}
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size.toLocaleString()} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => setRunDialogOpen(true)}>
              <FlaskConical className="size-4" />
              Start backtest
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative" onClick={() => setBlacklistOpen(true)}>
              <ShieldBan className="size-4" />
              Blacklist
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-negative hover:text-negative" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" />
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {data === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : data.totalAll === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-4 text-center">
          <p className="text-sm text-muted-foreground">No addresses yet. Add some, or copy your live traders over, then start a backtest on them.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead className="w-10 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-4 accent-primary"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                  />
                </TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="hidden md:table-cell">History cached</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Backtests</TableHead>
                <TableHead className="hidden lg:table-cell">Live</TableHead>
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loading && data !== null ? "opacity-70 transition-opacity" : undefined}>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No address matches &quot;{appliedSearch}&quot;.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((a) => (
                  <TableRow key={a.address} className="border-border/60" data-state={selected.has(a.address) ? "selected" : undefined}>
                    <TableCell className="pl-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${a.address}`}
                        className="size-4 accent-primary"
                        checked={selected.has(a.address)}
                        onChange={() => toggleOne(a.address)}
                      />
                    </TableCell>
                    <TableCell className="max-w-3xs sm:max-w-xs">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium">{a.label || "Unlabeled"}</span>
                          {a.userId ? (
                            <Badge variant="outline" className="border-positive/30 px-1.5 py-0 text-[10px] font-normal text-positive" title="Has a pump.fun user ID - trades are read from pump.fun directly (fast)">
                              API
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/30 px-1.5 py-0 text-[10px] font-normal text-amber-500" title="No pump.fun user ID - the wallet address is used in its place (also fast). Add the address again with its user ID to give the endpoint a second identifier to try.">
                              Address
                            </Badge>
                          )}
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground" title={a.address}>
                          <span className="sm:hidden">{formatAddress(a.address, 6)}</span>
                          <span className="hidden sm:inline">{a.address}</span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {a.cachedFrom && a.cachedTo ? `${formatDate(a.cachedFrom)} – ${formatDate(a.cachedTo)}` : "—"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{a.runCount}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {a.liveStatus === "active" ? (
                        <Badge variant="outline" className="border-positive/30 text-positive">
                          Tracked
                        </Badge>
                      ) : a.liveStatus === "blacklisted" ? (
                        <Badge variant="outline" className="border-negative/30 text-negative">
                          Blacklisted
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(a)} aria-label="Edit label" className="text-muted-foreground">
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.totalAll > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {loading && <Loader2 className="size-3 animate-spin" />}
            {total === 0
              ? "No matches"
              : `${((data.page - 1) * data.pageSize + 1).toLocaleString()}–${Math.min(total, data.page * data.pageSize).toLocaleString()} of ${total.toLocaleString()}${
                  appliedSearch.trim() ? ` matching (${data.totalAll.toLocaleString()} on the list)` : ""
                }`}
          </span>
          <div className="flex items-center gap-1.5">
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
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" /> Prev
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <EditLabelDialog entry={editing} onClose={() => setEditing(null)} onSaved={refresh} />

      <NewRunDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        selected={selectedList}
        allCount={data?.totalAll ?? 0}
        onCreated={(id) => router.push(`/backtest/${id}`)}
      />

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
            <AlertDialogDescription>
              They leave the backtest list only. Past backtests keep their results, cached history stays, and live Traders are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-negative text-negative-foreground hover:bg-negative/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // stay open to show the progress; handleDelete closes it when done
                handleDelete();
              }}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {deleting && deleteProgress ? `Removing ${deleteProgress.done.toLocaleString()} / ${deleteProgress.total.toLocaleString()}` : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
