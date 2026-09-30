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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import {
  addTradersToList,
  deleteTraderList,
  createTraderList,
  listTraderLists,
  removeTradersFromList,
} from "@/lib/api";
import type { TraderListView } from "@/lib/types";

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
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Manage lists</DialogTitle>
          <DialogDescription>Deleting a list removes it from every trader tagged with it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          {loading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)
          ) : lists.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No lists yet.</p>
          ) : (
            lists.map((list) => (
              <div key={list._id} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/40">
                <span className="truncate text-sm">
                  {list.name} <span className="text-xs text-muted-foreground">({list.memberCount})</span>
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" disabled={pendingId === list._id} className="size-7 p-0 text-muted-foreground hover:text-negative">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete &quot;{list.name}&quot;?</AlertDialogTitle>
                      <AlertDialogDescription>This removes it from every trader tagged with it.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-negative text-negative-foreground hover:bg-negative/90"
                        onClick={() => handleDelete(list)}
                      >
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
 * Per-trader "add to list(s)" action - a dropdown of every list as a
 * checkbox (toggles membership immediately), an inline create-new-list
 * field, and a "Manage lists..." entry that opens a separate dialog for
 * renaming/deleting lists (kept out of this dropdown to avoid nesting an
 * AlertDialog inside a DropdownMenu, mirroring how the profile switcher's
 * "Create new profile" item already opens a sibling Dialog rather than
 * building the form inline).
 */
export function ManageListsMenu({
  traderAddress,
  currentListIds,
  onChanged,
}: {
  traderAddress: string;
  currentListIds: string[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [lists, setLists] = useState<TraderListView[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingListId, setPendingListId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

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

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="size-7 p-0 text-muted-foreground hover:text-foreground" aria-label="Add to list">
            <Tag className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Add to list</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
          ) : lists.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No lists yet - create one below.</div>
          ) : (
            lists.map((list) => (
              <DropdownMenuCheckboxItem
                key={list._id}
                checked={currentListIds.includes(list._id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => toggle(list, checked)}
                className="justify-between"
              >
                <span className="truncate">{list.name}</span>
                {pendingListId === list._id && <Loader2 className="size-3 animate-spin" />}
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
            <Button size="sm" variant="ghost" className="size-7 shrink-0 p-0" disabled={creating || !newName.trim()} onClick={handleCreate}>
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
            className="text-muted-foreground"
          >
            Manage lists…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );
}
