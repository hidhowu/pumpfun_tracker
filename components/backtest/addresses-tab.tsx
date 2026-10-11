"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, FlaskConical, Loader2, Pencil, Search, ShieldBan, Trash2 } from "lucide-react";
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
import { deleteBacktestAddresses, importTradersToBacktest, listBacktestAddresses, updateBacktestAddress } from "@/lib/backtest-api";
import { listTraderLists } from "@/lib/api";
import { formatAddress } from "@/lib/format";
import type { BacktestAddressView } from "@/lib/backtest-types";
import type { TraderListView } from "@/lib/types";
import { AddAddressesDialog } from "./add-addresses-dialog";
import { BlacklistDialog } from "./blacklist-dialog";
import { NewRunDialog } from "./new-run-dialog";
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

/** The backtest list: add / import / label / remove addresses, then pick some and start a backtest on them. */
export function AddressesTab() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<BacktestAddressView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [lists, setLists] = useState<TraderListView[]>([]);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<BacktestAddressView | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { addresses } = await listBacktestAddresses();
      setAddresses(addresses);
      // Drop selections that no longer exist (removed elsewhere).
      setSelected((prev) => {
        const alive = new Set(addresses.map((a) => a.address));
        const next = new Set([...prev].filter((a) => alive.has(a)));
        return next.size === prev.size ? prev : next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load the backtest list");
    }
  }, []);

  useEffect(() => {
    refresh();
    listTraderLists()
      .then(({ lists }) => setLists(lists))
      .catch(() => {});
  }, [refresh]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!addresses) return [];
    if (!q) return addresses;
    return addresses.filter((a) => a.address.toLowerCase().includes(q) || a.label.toLowerCase().includes(q));
  }, [addresses, search]);

  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.address));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((a) => next.delete(a.address));
      else visible.forEach((a) => next.add(a.address));
      return next;
    });
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
    try {
      const { deletedCount } = await deleteBacktestAddresses([...selected]);
      toast.success(`Removed ${deletedCount} address${deletedCount === 1 ? "" : "es"} from the backtest list`);
      setSelected(new Set());
      setConfirmDelete(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setDeleting(false);
    }
  }

  const selectedList = [...selected];

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
        <AddAddressesDialog onAdded={refresh} />
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
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

      {addresses === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : addresses.length === 0 ? (
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
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No address matches &quot;{search}&quot;.
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
                            <Badge variant="outline" className="border-amber-500/30 px-1.5 py-0 text-[10px] font-normal text-amber-500" title="No pump.fun user ID - the chain is read over RPC (slow). Add the address again with its user ID to speed it up.">
                              RPC
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

      <EditLabelDialog entry={editing} onClose={() => setEditing(null)} onSaved={refresh} />

      <NewRunDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        selected={selectedList}
        allAddresses={(addresses ?? []).map((a) => a.address)}
        noUserIdAddresses={new Set((addresses ?? []).filter((a) => !a.userId).map((a) => a.address))}
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

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selected.size} address{selected.size === 1 ? "" : "es"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They leave the backtest list only. Past backtests keep their results, cached history stays, and live Traders are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-negative text-negative-foreground hover:bg-negative/90" disabled={deleting} onClick={handleDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
