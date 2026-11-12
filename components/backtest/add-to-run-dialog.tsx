"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ListPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { addAddressesToRunBatched, addBacktestAddresses, addListToRun, listBacktestAddresses, type AddressEntry, type AddToRunTotals } from "@/lib/backtest-api";
import { parseAddressInput } from "./add-addresses-dialog";
import { BatchProgress, type BatchState } from "./batch-progress";
import { DialogHead, Field, Notice } from "./dialog-parts";

const BATCH = 5000;
const SOURCES = [
  { value: "list", label: "From the backtest list" },
  { value: "paste", label: "Paste addresses" },
] as const;

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
      <DialogContent className="sm:max-w-[520px]" onInteractOutside={(e) => working && e.preventDefault()} onEscapeKeyDown={(e) => working && e.preventDefault()}>
        {working && state ? (
          <BatchProgress
            title="Adding addresses to this backtest…"
            note="Done in batches so the page and the server stay responsive."
            state={state}
            stopping={stopping}
            onStop={() => {
              stopRequested.current = true;
              setStopping(true);
            }}
          />
        ) : (
          <>
            <DialogHead
              icon={<ListPlus className="size-5" />}
              title={`Add addresses to "${run.name}"`}
              help="Adds to this backtest instead of starting another. A running one picks them up at once; a finished one is paused with the new ones waiting - Resume processes only them. Addresses already in it are skipped."
              description="Add addresses from the backtest list or paste new ones."
            />
            <Segmented options={SOURCES} value={mode} onChange={setMode} label="Where the addresses come from" block tall />
            {mode === "list" ? (
              <div className="flex flex-col gap-3">
                <Field label="Only addresses containing" optional htmlFor="add-run-search" note="Leave empty for the whole list.">
                  <Input id="add-run-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="leave empty for the whole list" className="font-mono text-xs max-md:h-11" />
                </Field>
                <Notice tone="info">
                  Adds all {listSize != null ? listSize.toLocaleString() : "…"} address{listSize === 1 ? "" : "es"} on the backtest list{search.trim() ? " that match" : ""} that are not in this one yet. To add only some,
                  select them in the Addresses tab and use &quot;Add to a backtest&quot; there.
                </Notice>
              </div>
            ) : (
              <Field label="Addresses" htmlFor="add-run-paste" note={`${parsed.entries.length.toLocaleString()} address(es) detected - they are added to the backtest list as well, then to this backtest.`}>
                <Textarea
                  id="add-run-paste"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="One address per line (optionally followed by a label), or JSON with walletAddress / userId"
                  className="min-h-36 font-mono text-xs"
                />
              </Field>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button className="gap-1.5" onClick={mode === "list" ? addFromList : addPasted} disabled={mode === "list" ? listSize === 0 : parsed.entries.length === 0}>
                {mode === "list" && listSize === null ? <Loader2 className="animate-spin" /> : <ListPlus />}
                Add
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
