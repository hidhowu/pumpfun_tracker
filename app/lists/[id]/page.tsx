"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, LineChart, ListChecks, Loader2, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListNameDialog } from "@/components/lists/list-name-dialog";
import { ListPerformanceTab } from "@/components/lists/list-performance-tab";
import { WalletTradersDailyTable } from "@/components/wallets/wallet-traders-daily-table";
import { deleteTraderList, getListTradersDaily, listTraderLists, renameTraderList } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";

/** One list's combined performance on the currently selected profile - chart + per-trader breakdown. */
export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentProfileId, currentProfile } = useProfile();
  const [name, setName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    listTraderLists()
      .then(({ lists }) => setName(lists.find((l) => l._id === id)?.name ?? ""))
      .catch(() => setName(""));
  }, [id]);

  async function handleRename(next: string) {
    try {
      const { list } = await renameTraderList(id, next);
      setName(list.name);
      toast.success("List renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename list");
      throw e;
    }
  }

  async function handleDelete() {
    if (!name) return;
    setDeleting(true);
    try {
      await deleteTraderList(id);
      toast.success(`List "${name}" deleted`);
      router.push("/lists");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete list");
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <Link href="/lists" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Back to lists
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-surface-3 text-primary">
            <ListChecks className="size-[18px]" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[22px] leading-7 font-semibold tracking-[-0.02em]">{name === null ? "…" : name || "List not found"}</span>
            {currentProfile && name ? <span className="text-xs text-text-3">Performance on profile &quot;{currentProfile.name}&quot;</span> : null}
          </div>
        </div>
        {name ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenaming(true)} className="gap-1.5">
              <Pencil className="size-3.5" />
              Rename
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} className="gap-1.5 text-text-2 hover:border-destructive/40 hover:text-negative">
              <Trash2 className="size-3.5" />
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      {currentProfileId && name !== "" ? (
        <Tabs defaultValue="performance" className="flex flex-col gap-4 md:gap-5">
          {/* Wide screens: underlined tabs with icons. */}
          <TabsList variant="line" className="hidden h-11 w-full gap-1 border-b border-border p-0 md:flex">
            {[
              { value: "performance", label: "Performance", icon: LineChart },
              { value: "traders", label: "Traders Performance", icon: Users },
            ].map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="h-11 flex-none gap-2 rounded-none px-3.5 text-sm font-medium after:inset-x-2.5 group-data-horizontal/tabs:after:bottom-0 data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
              >
                <t.icon className="size-3.5" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {/* Phone: two equal buttons. */}
          <TabsList className="grid h-auto w-full grid-cols-2 md:hidden">
            <TabsTrigger value="performance" className="h-11 justify-center">
              Performance
            </TabsTrigger>
            <TabsTrigger value="traders" className="h-11 justify-center">
              Traders
            </TabsTrigger>
          </TabsList>

          <TabsContent value="performance">
            <ListPerformanceTab key={currentProfileId} listId={id} profileId={currentProfileId} />
          </TabsContent>

          <TabsContent value="traders" className="flex flex-col gap-3">
            <div className="flex flex-col overflow-hidden rounded-[20px] md:border md:border-border md:bg-card">
              <div className="flex items-center px-1 pb-1 md:border-b md:border-border md:p-5 md:py-4">
                <b className="text-[15px] font-semibold">
                  Traders in this list
                  <HelpTip>Realized P&amp;L per day for the last 7 days, plus each trader&apos;s overall total on this profile.</HelpTip>
                </b>
              </div>
              <WalletTradersDailyTable
                key={currentProfileId}
                load={() => getListTradersDaily(id, currentProfileId)}
                emptyMessage="No traders in this list yet - tag some with the list button on the Traders page."
              />
            </div>
          </TabsContent>
        </Tabs>
      ) : null}

      <ListNameDialog open={renaming} onOpenChange={setRenaming} title="Rename list" submitLabel="Save" initialName={name ?? ""} onSubmit={handleRename} />

      <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleting && setConfirmDelete(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>It is removed from every trader tagged with it. The traders and their history are not deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete list
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
