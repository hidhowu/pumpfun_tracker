"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createBacktestViews, updateBacktestView } from "@/lib/backtest-api";
import type { BacktestViewConfig, BacktestViewDefinition, BacktestViewSource } from "@/lib/backtest-types";
import { formatUsd } from "@/lib/format";
import { CombinedFields, parseCombined, toCombinedValues, type CombinedValues } from "./combined-fields";

type Props = {
  runId: string;
  /** What the backtest itself was simulated with; the new combined backtest starts from these numbers. */
  source: BacktestViewSource;
  /** The starting balance to suggest (the backtest's own wallet, if it has one). */
  suggestedBalanceUsd: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (created: BacktestViewDefinition[] | null) => void;
  /** Editing one combination instead of creating a new one. Its `addresses` must be loaded. */
  editing?: BacktestViewDefinition;
};

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** One address per line. Returns the distinct addresses and the (1-based) numbers of the lines that are not a single address. */
export function parseAddressLines(text: string): { addresses: string[]; badLines: number[] } {
  const addresses: string[] = [];
  const badLines: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (ADDRESS.test(line)) addresses.push(line);
    else badLines.push(i + 1);
  });
  return { addresses: [...new Set(addresses)], badLines };
}

const initialValues = (source: BacktestViewSource, balance: number, editing?: BacktestViewDefinition): CombinedValues =>
  toCombinedValues(
    editing ?? {
      startingBalanceUsd: balance,
      tradeSizeUsd: source.tradeSizeUsd ?? 10,
      pumpFeePercent: source.pumpFeePercent ?? 1.25,
      jitoFeeUsd: source.jitoFeeUsd ?? 0,
      resetDaily: false,
      allowNegativeBalance: true,
    }
  );

/**
 * Makes ONE combined backtest from a finished backtest - or edits one: a named group of its addresses (one per line) traded as a single wallet with its own
 * starting balance, trade amount and fees. Nothing is simulated again: the backtest's stored trades are re-priced with the numbers entered here.
 */
export function NewViewDialog({ runId, source, suggestedBalanceUsd, open, onOpenChange, onSaved, editing }: Props) {
  const [values, setValues] = useState<CombinedValues>(() => initialValues(source, suggestedBalanceUsd, editing));
  const [scope, setScope] = useState<"all" | "listed">(editing?.allAddresses ? "all" : "listed");
  const [name, setName] = useState(editing?.name ?? "");
  const [text, setText] = useState(editing?.addresses?.join("\n") ?? "");
  const [busy, setBusy] = useState(false);

  const numbers = parseCombined(values);
  const parsed = useMemo(() => parseAddressLines(text), [text]);
  const listedOk = scope === "all" || (parsed.addresses.length > 0 && parsed.badLines.length === 0);
  const canSave = !busy && !!numbers && listedOk && (!editing || name.trim().length > 0);

  async function save() {
    if (!numbers) return;
    const config: BacktestViewConfig = numbers;
    const addresses = scope === "all" ? [] : parsed.addresses;
    setBusy(true);
    try {
      if (editing) {
        await updateBacktestView(runId, editing._id, { name: name.trim(), addresses, config });
        toast.success("Combined backtest updated");
        onSaved(null);
      } else {
        const res = await createBacktestViews(runId, { views: [{ name: name.trim() || undefined, addresses }], config });
        toast.success(`Created "${res.views[0].name}"`);
        onSaved(res.views);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      {/* The grid column is allowed to shrink below its content (minmax(0,1fr)) so long addresses and help texts wrap or scroll inside the dialog instead of pushing it wider. */}
      <DialogContent className="max-h-[88vh] grid-cols-[minmax(0,1fr)] overflow-x-hidden overflow-y-auto sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4" /> {editing ? "Edit combined backtest" : "New combined backtest"}
          </DialogTitle>
          <DialogDescription>
            The addresses trade as ONE wallet with a shared starting balance, using the trades this backtest already simulated, re-priced with the amount and fees below. Nothing is fetched or
            simulated again
            {source.tradeSizeUsd != null && (
              <>
                {" "}
                (this backtest used {formatUsd(source.tradeSizeUsd)} per trade, {source.pumpFeePercent ?? 0}% + {formatUsd(source.jitoFeeUsd ?? 0)} fees).
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="bt-view-name">Name</Label>
            <Input id="bt-view-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Safe 5 at $10" maxLength={80} />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label>Addresses</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as "all" | "listed")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="listed">Only the addresses I list</SelectItem>
                <SelectItem value="all">Every address of this backtest</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scope === "listed" && (
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="bt-view-addresses">One address per line</Label>
              <Textarea
                id="bt-view-addresses"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                wrap="off"
                placeholder={"Paste the addresses of this combination,\none on each line"}
                aria-invalid={parsed.badLines.length > 0}
                // field-sizing-fixed: the box keeps its own size (the default grows with the text); long lines scroll sideways inside it.
                className="h-52 max-w-full resize-y overflow-auto font-mono text-xs whitespace-pre field-sizing-fixed"
              />
              {parsed.badLines.length > 0 ? (
                <p className="text-xs text-negative">
                  {parsed.badLines.length === 1 ? `Line ${parsed.badLines[0]} is` : `Lines ${parsed.badLines.slice(0, 6).join(", ")}${parsed.badLines.length > 6 ? "…" : ""} are`} not a single address - put exactly one
                  address on each line, no commas or spaces.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {parsed.addresses.length > 0 ? `${parsed.addresses.length} address${parsed.addresses.length === 1 ? "" : "es"}` : "No addresses yet"} · every address must be part of this backtest.
                </p>
              )}
            </div>
          )}

          <div className="min-w-0">
            <CombinedFields values={values} onChange={setValues} idPrefix="bt-view" recalculated />
          </div>
          <p className="text-xs text-muted-foreground">
            Same entries and exits as the backtest, new amounts and fees. Stop-loss, take-profit and trailing stops were judged with the backtest&apos;s own fees, so with very different fees a
            trade sitting right at a threshold could have exited a moment earlier or later.
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={save} disabled={!canSave} className="gap-1.5">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save" : "Create combined backtest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
