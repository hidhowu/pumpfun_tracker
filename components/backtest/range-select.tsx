"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ListChecks, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBacktestAddressRange } from "@/lib/backtest-api";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

const PRESETS = [1000, 2500, 5000, 10000];

type Props = {
  /** How many addresses match the current search (the rows that can be selected). */
  total: number;
  search: string;
  /** Replaces the selection with these addresses. */
  onSelect: (addresses: string[]) => void;
};

/**
 * Selects a slice of the list instead of one checkbox at a time: "the first 2,500", "rows 5,001 to 10,000", or "the next batch" of the
 * same size as the last one. Rows are numbered in the order the list is shown (newest first, within the current search), so they
 * shift when addresses are removed. The selection is REPLACED, so working through a long list in batches is: select, act, repeat.
 * On phones it folds into a one-line summary.
 */
export function RangeSelect({ total, search, onSelect }: Props) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ from: number; to: number; total: number } | null>(null);
  const request = useRef(0);

  async function select(rawFrom: number, rawTo: number) {
    const start = Math.max(1, Math.floor(rawFrom));
    const end = Math.min(total, Math.floor(rawTo));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      toast.error(total === 0 ? "There are no addresses to select" : `Choose rows between 1 and ${total.toLocaleString()}, with "from" not above "to"`);
      return;
    }
    const mine = ++request.current;
    setBusy(true);
    try {
      const addresses = await getBacktestAddressRange(start, end, search);
      if (mine !== request.current) return;
      onSelect(addresses);
      setFrom(String(start));
      setTo(String(end));
      setLast({ from: start, to: end, total });
      toast.success(`Selected rows ${start.toLocaleString()}–${(start + addresses.length - 1).toLocaleString()} (${addresses.length.toLocaleString()} addresses)`);
    } catch (e) {
      if (mine === request.current) toast.error(e instanceof Error ? e.message : "Failed to select the rows");
    } finally {
      if (mine === request.current) setBusy(false);
    }
  }

  const numeric = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);
  const size = last ? last.to - last.from + 1 : 0;
  // "Next batch" only makes sense while the list is the one the last range was taken from (removing addresses renumbers the rows).
  const canNext = last !== null && last.total === total && last.to < total;
  const expanded = !phone || open;

  const body = (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      {!phone && (
        <span className="flex items-center gap-2 pb-1.5 text-[13px] font-semibold">
          <ListChecks className="size-4 text-text-3" /> Select rows
        </span>
      )}
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-3">
          From
          <Input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/[^0-9]/g, ""))} className="h-9 w-24 max-md:h-11" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-3">
          To
          <Input inputMode="numeric" value={to} placeholder={total > 0 ? total.toLocaleString() : ""} onChange={(e) => setTo(e.target.value.replace(/[^0-9]/g, ""))} className="h-9 w-24 max-md:h-11" />
        </label>
        <Button className="h-9 max-md:h-11" disabled={busy || total === 0} onClick={() => select(numeric(from) || 1, to.trim() === "" ? total : numeric(to))}>
          {busy && <Loader2 className="animate-spin" />}
          Select
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
        <span className="text-xs text-text-3">First</span>
        {PRESETS.filter((n) => n < total).map((n) => (
          <Button key={n} size="sm" variant="outline" className="max-md:h-10" disabled={busy} onClick={() => select(1, n)}>
            {n.toLocaleString()}
          </Button>
        ))}
        <Button size="sm" variant="outline" className="max-md:h-10" disabled={busy || total === 0} onClick={() => select(1, total)}>
          All {total.toLocaleString()}
        </Button>
        {canNext && last && (
          <Button size="sm" variant="secondary" className="max-md:h-10" disabled={busy} onClick={() => select(last.to + 1, last.to + size)}>
            Next {size.toLocaleString()}
          </Button>
        )}
      </div>
      <p className="basis-full text-[11px] text-text-3">
        Rows follow the list below (newest first{search.trim() ? ", within your search" : ""}). Selecting replaces the current selection, and the row numbers shift after you remove addresses.
      </p>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface-2">
      {phone && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left">
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[15px] font-semibold">Select rows</b>
            <span className="text-xs text-text-3">From 1 to {total.toLocaleString()} · first 1,000 / 2,500 / 5,000 / all · next batch</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} />
        </button>
      )}
      {expanded && <div className={cn("px-4 py-3", phone && "border-t border-border")}>{body}</div>}
    </div>
  );
}
