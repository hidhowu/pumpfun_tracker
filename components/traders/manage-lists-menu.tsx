"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Tag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { CheckMark, DialogHead } from "@/components/ui/dialog-parts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  addTradersToList,
  deleteTraderList,
  createTraderList,
  listTraderLists,
  removeTradersFromList,
} from "@/lib/api";
import type { TraderListView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Rename/delete surface for every list - reachable from the per-row menu below, mirrors the /proxies page's row-delete pattern. */
function ManageListsDialog({
  open,
  onOpenChange,
  lists,
  loading,
  onListDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lists: TraderListView[];
  loading: boolean;
  onListDeleted: (id: string) => void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleDelete(list: TraderListView) {
    setPendingId(list._id);
    try {
      await deleteTraderList(list._id);
      toast.success(`List "${list.name}" deleted`);
      onListDeleted(list._id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete list");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHead icon={<Tag className="size-5" />} title="Manage lists" description="Deleting a list removes it from every trader tagged with it." />
        <p className="-mt-2 text-sm text-text-2">Deleting a list removes it from every trader tagged with it.</p>
        <div className="flex flex-col gap-1">
          {loading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-[10px]" />)
          ) : lists.length === 0 ? (
            <p className="py-4 text-center text-sm text-text-3">No lists yet.</p>
          ) : (
            lists.map((list) => (
              <div key={list._id} className="flex min-h-11 items-center justify-between gap-2 rounded-[10px] px-2 even:bg-transparent odd:bg-surface-2">
                <span className="min-w-0 truncate text-sm">
                  {list.name} <span className="text-xs text-text-3">({list.memberCount})</span>
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon-sm" disabled={pendingId === list._id} className="text-text-3 hover:text-negative" aria-label={`Delete ${list.name}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogMedia className="bg-neg-soft text-negative">
                        <Trash2 />
                      </AlertDialogMedia>
                      <AlertDialogTitle>Delete &quot;{list.name}&quot;?</AlertDialogTitle>
                      <AlertDialogDescription>This removes it from every trader tagged with it.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={() => handleDelete(list)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-trader "add to list(s)" action - on a desktop a dropdown of every list as a checkbox (toggles membership immediately), an inline
 * create-new-list field, and a "Manage lists..." entry that opens a separate dialog for deleting lists (kept out of the dropdown to avoid
 * nesting an AlertDialog inside a DropdownMenu). On a phone the same rows are a bottom sheet with a Done button.
 */
export function ManageListsMenu({
  traderAddress,
  currentListIds,
  onChanged,
  triggerClassName,
}: {
  traderAddress: string;
  currentListIds: string[];
  onChanged: () => void;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [lists, setLists] = useState<TraderListView[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const phone = !useMediaQuery("(min-width: 768px)");

  const refreshLists = () => {
    setLoading(true);
    return listTraderLists()
      .then(({ lists }) => setLists(lists))
      .catch(() => toast.error("Failed to load lists"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open || manageOpen) refreshLists();
  }, [open, manageOpen]);

  async function toggle(list: TraderListView, checked: boolean) {
    setPendingListId(list._id);
    try {
      if (checked) await addTradersToList(list._id, [traderAddress]);
      else await removeTradersFromList(list._id, [traderAddress]);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update list membership");
    } finally {
      setPendingListId(null);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const { list } = await createTraderList(name);
      await addTradersToList(list._id, [traderAddress]);
      setNewName("");
      await refreshLists();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create list");
    } finally {
      setCreating(false);
    }
  }

  const trigger = (
    <Button variant="ghost" size="sm" className={cn("size-7 p-0 text-text-2 hover:text-foreground", triggerClassName)} aria-label="Add to list" onClick={phone ? () => setOpen(true) : undefined}>
      <Tag className="size-3.5" />
    </Button>
  );

  const manageDialog = (
    <ManageListsDialog
      open={manageOpen}
      onOpenChange={setManageOpen}
      lists={lists}
      loading={loading}
      onListDeleted={(id) => {
        setLists((prev) => prev.filter((l) => l._id !== id));
        onChanged();
      }}
    />
  );

  if (phone) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHead icon={<Tag className="size-5" />} title="Add to list" description="Tick the lists this trader belongs to." />
            <div className="flex flex-col">
              {loading && lists.length === 0 ? (
                <Skeleton className="h-14 w-full rounded-[10px]" />
              ) : lists.length === 0 ? (
                <p className="py-3 text-sm text-text-3">No lists yet - create one below.</p>
              ) : (
                lists.map((list) => {
                  const checked = (currentListIds ?? []).includes(list._id);
                  return (
                    <button
                      key={list._id}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      disabled={pendingListId === list._id}
                      onClick={() => toggle(list, !checked)}
                      className="flex min-h-14 items-center gap-3 border-b border-border text-left text-[15px] last:border-b-0"
                    >
                      <CheckMark checked={checked} className="size-[22px]" />
                      <span className="min-w-0 flex-1 truncate">{list.name}</span>
                      {pendingListId === list._id ? <Loader2 className="size-4 shrink-0 animate-spin text-text-3" /> : <span className="text-xs text-text-3">{list.memberCount}</span>}
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} placeholder="New list name" aria-label="New list name" className="h-12 text-base" />
              <Button variant="outline" size="icon-lg" className="size-12 shrink-0" disabled={creating || !newName.trim()} onClick={handleCreate} aria-label="Create list">
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              </Button>
            </div>
            <DialogFooter className="flex-col">
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setManageOpen(true);
                }}
              >
                Manage lists…
              </Button>
              <Button size="lg" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {manageDialog}
      </>
    );
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Add to list</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="px-2 py-1.5 text-xs text-text-3">Loading…</div>
          ) : lists.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-text-3">No lists yet - create one below.</div>
          ) : (
            lists.map((list) => (
              <DropdownMenuCheckboxItem
                key={list._id}
                checked={(currentListIds ?? []).includes(list._id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => toggle(list, checked)}
                className="justify-between"
              >
                <span className="min-w-0 truncate">{list.name}</span>
                {pendingListId === list._id && <Loader2 className="size-3 shrink-0 animate-spin" />}
              </DropdownMenuCheckboxItem>
            ))
          )}
          <DropdownMenuSeparator />
          <div className="flex items-center gap-1 px-1.5 py-1" onKeyDown={(e) => e.stopPropagation()}>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="New list name"
              className="h-7 text-xs"
            />
            <Button size="sm" variant="ghost" className="size-7 shrink-0 p-0" disabled={creating || !newName.trim()} onClick={handleCreate} aria-label="Create list">
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            </Button>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setOpen(false);
              setManageOpen(true);
            }}
            className="text-text-2"
          >
            Manage lists…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {manageDialog}
    </>
  );
}
