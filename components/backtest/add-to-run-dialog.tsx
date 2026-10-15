"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ListPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addAddressesToRunBatched, addBacktestAddresses, addListToRun, listBacktestAddresses, type AddressEntry, type AddToRunTotals } from "@/lib/backtest-api";
import { cn } from "@/lib/utils";
import { parseAddressInput } from "./add-addresses-dialog";
import { BatchProgress, type BatchState } from "./batch-progress";

const BATCH = 500;

type Props = {
  run: { _id: string; name: string; status: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
};

/** What to tell the user once addresses have been added to a backtest. */
function summary(t: AddToRunTotals, before: string): string {
  const parts = [`${t.added.toLocaleString()} added to this backtest`];
  if (t.alreadyInRun) parts.push(`${t.alreadyInRun.toLocaleString()} were already in it`);
  if (t.notOnList) parts.push(`${t.notOnList.toLocaleString()} not on the backtest list`);
  const wasFinished = before === "completed" || before === "failed";
  return parts.join(", ") + (t.added > 0 && wasFinished && t.status === "paused" ? ". It is paused with the new addresses waiting - press Resume to process them (the finished ones are not redone)." : t.added > 0 ? "." : "");
}

/**
 * Adds more addresses to a backtest that already exists - while it is running, queued, paused or finished - instead of making another backtest with
 * the same settings. A running one just picks them up; a finished one is paused so Resume works through only the new ones.
 */
export function AddToRunDialog({ run, open, onOpenChange, onAdded }: Props) {
  const [mode, setMode] = useState<"list" | "paste">("list");
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [listSize, setListSize] = useState<number | null>(null);
  const [state, setState] = useState<BatchState | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const working = state !== null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listBacktestAddresses({ limit: 1 })
      .then((r) => !cancelled && setListSize(r.totalAll))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const parsed = useMemo(() => (mode === "paste" ? parseAddressInput(text) : { entries: [] }), [mode, text]);

  async function addFromList() {
    stopRequested.current = false;
    setStopping(false);
    setState({ done: 0, total: listSize ?? 0, lines: [] });
    let totals: (AddToRunTotals & { stopped: boolean }) | null = null;
    try {
      totals = await addListToRun(run._id, {
        search,
        expected: listSize ?? undefined,
        shouldStop: () => stopRequested.current,
        onProgress: (done, total) => setState((s) => ({ lines: s?.lines ?? [], done, total })),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add the addresses");
    }
    setState(null);
    if (totals) {
      toast.success(`${totals.stopped ? "Stopped. " : ""}${summary(totals, run.status)}`);
      onAdded();
      if (!totals.stopped) onOpenChange(false);
    } else {
      onAdded(); // some pages may have gone through before it failed
    }
  }

  async function addPasted() {
    const { entries, error } = parsed as ReturnType<typeof parseAddressInput>;
    if (error) return toast.error(error);
    if (entries.length === 0) return toast.error("Paste at least one address");
    stopRequested.current = false;
    setStopping(false);
    const totals: AddToRunTotals = { added: 0, alreadyInRun: 0, notOnList: 0, status: null };
    let invalid = 0;
    let doneEntries = 0;
    let failure: string | null = null;
    setState({ done: 0, total: entries.length, lines: [] });
    for (let i = 0; i < entries.length; i += BATCH) {
      if (stopRequested.current) break;
      const batch = entries.slice(i, i + BATCH);
      try {
        // onto the backtest list first (new ones; a user id given for a listed one is kept), then into this backtest
        const onList = await addBacktestAddresses(batch as AddressEntry[]);
        invalid += onList.invalid.length;
        const valid = batch.map((e) => e.address).filter((a) => !onList.invalid.includes(a) && !(onList.blacklisted ?? []).includes(a));
        if (valid.length > 0) {
          const r = await addAddressesToRunBatched(run._id, valid);
          totals.added += r.added;
          totals.alreadyInRun += r.alreadyInRun;
          totals.notOnList += r.notOnList;
          totals.status = r.status;
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : "Failed to add the addresses";
        break;
      }
      doneEntries = Math.min(entries.length, i + batch.length);
      setState({ done: doneEntries, total: entries.length, lines: [`${totals.added.toLocaleString()} added`, `${totals.alreadyInRun.toLocaleString()} already in`] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setState(null);
    const extra = invalid > 0 ? `, ${invalid.toLocaleString()} invalid` : "";
    if (failure) toast.error(`${failure}. ${doneEntries.toLocaleString()} of ${entries.length.toLocaleString()} were processed (${summary(totals, run.status)}${extra}) - press Add again to continue.`);
    else toast.success(`${doneEntries < entries.length ? "Stopped. " : ""}${summary(totals, run.status)}${extra}`);
    if (totals.added > 0) onAdded();
    if (!failure && doneEntries >= entries.length) {
      setText("");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => working && e.preventDefault()} onEscapeKeyDown={(e) => working && e.preventDefault()}>
        {working && state ? (
          <BatchProgress
            title="Adding addresses to this backtest…"
            note="Done in batches so the page and the server stay responsive. Closing is disabled until it finishes or you stop it."
            state={state}
            stopping={stopping}
            onStop={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add addresses to &quot;{run.name}&quot;</DialogTitle>
              <DialogDescription>
                Grow this backtest instead of starting another with the same settings. If it is running, the new addresses are picked up at once. If it has finished, it is
                paused with the new ones waiting - press Resume and only they are processed. Addresses already in it are skipped.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={mode === "list" ? "default" : "outline"} onClick={() => setMode("list")}>
                From the backtest list
              </Button>
              <Button type="button" size="sm" variant={mode === "paste" ? "default" : "outline"} onClick={() => setMode("paste")}>
                Paste addresses
              </Button>
            </div>
            {mode === "list" ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Only addresses containing (optional)
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="leave empty for the whole list" className="h-9 font-mono text-xs" />
                </label>
                <p className="text-xs text-muted-foreground">
                  Adds every address on the backtest list{search.trim() ? " that matches" : ""} that is not in this backtest yet.
                  {listSize != null ? ` The list has ${listSize.toLocaleString()} address${listSize === 1 ? "" : "es"}.` : ""} To add only some, select them in the Addresses tab and use
                  &quot;Add to a backtest&quot; there.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="One address per line (optionally followed by a label), or JSON with walletAddress / userId"
                  className={cn("min-h-36 font-mono text-xs")}
                />
                <p className="text-xs text-muted-foreground">
                  {parsed.entries.length.toLocaleString()} address(es) detected - they are added to the backtest list as well, then to this backtest.
                </p>
              </div>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button className="gap-1.5" onClick={mode === "list" ? addFromList : addPasted} disabled={mode === "list" ? listSize === 0 : parsed.entries.length === 0}>
                {mode === "list" && listSize === null ? <Loader2 className="size-4 animate-spin" /> : <ListPlus className="size-4" />}
                Add
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
