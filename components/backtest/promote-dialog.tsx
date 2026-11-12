"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { promoteBacktestAddresses } from "@/lib/backtest-api";
import { listTraderLists } from "@/lib/api";
import type { TraderListView } from "@/lib/types";
import { BatchProgress, type BatchState } from "./batch-progress";
import { DialogHead, Field } from "./dialog-parts";

const NO_LIST = "none";

/**
 * "Add to live Traders" for the selected addresses of a backtest: optionally into one of the trader lists as well. Sent in batches, so a selection of
 * thousands is fine and neither the page nor the server hangs.
 */
export function PromoteDialog({ runId, addresses, open, onOpenChange, onDone }: { runId: string; addresses: string[]; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [lists, setLists] = useState<TraderListView[] | null>(null);
  const [listId, setListId] = useState(NO_LIST);
  const [state, setState] = useState<BatchState | null>(null);
  const working = state !== null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listTraderLists()
      .then(({ lists }) => !cancelled && setLists(lists))
      .catch(() => !cancelled && setLists([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function run() {
    setState({ done: 0, total: addresses.length, lines: [] });
    try {
      const res = await promoteBacktestAddresses(runId, addresses, {
        listId: listId === NO_LIST ? undefined : listId,
        onProgress: (done, total) => setState({ done, total, lines: [] }),
      });
      const parts = [`${res.added.length.toLocaleString()} added to Traders`];
      if (res.skipped.length) parts.push(`${res.skipped.length.toLocaleString()} already tracked`);
      if (res.blacklisted.length) parts.push(`${res.blacklisted.length.toLocaleString()} blacklisted (not re-added)`);
      if (listId !== NO_LIST) parts.push(`${res.tagged.toLocaleString()} put in "${lists?.find((l) => l._id === listId)?.name ?? "the list"}"`);
      toast.success(parts.join(", "));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add to Traders");
    } finally {
      setState(null);
      onDone();
    }
  }

  const count = `${addresses.length.toLocaleString()} address${addresses.length === 1 ? "" : "es"}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <DialogContent className="sm:max-w-[460px]" onInteractOutside={(e) => working && e.preventDefault()} onEscapeKeyDown={(e) => working && e.preventDefault()}>
        {working && state ? (
          <BatchProgress title="Adding to live Traders…" note="Sent in batches so the page and the server stay responsive." state={state} stopping={false} />
        ) : (
          <>
            <DialogHead
              icon={<UserPlus className="size-5" />}
              title={`Add ${count} to live Traders`}
              help="They start being tracked for live copy-trading. Ones already tracked are skipped and blacklisted ones stay blacklisted."
              description="Add the selected addresses to live Traders, optionally into a list."
            />
            <Field label="Also add them to a list" htmlFor="promote-list">
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger id="promote-list" className="w-full max-md:h-11">
                  <SelectValue placeholder={lists === null ? "Loading lists…" : "No list"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LIST}>Don&apos;t put them in a list</SelectItem>
                  {(lists ?? []).map((l) => (
                    <SelectItem key={l._id} value={l._id}>
                      {l.name} ({l.memberCount.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button className="gap-1.5" disabled={addresses.length === 0} onClick={run}>
                <UserPlus /> Add to Traders
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
