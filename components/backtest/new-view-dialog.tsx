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
  /** What the backtest itself was simulated with; the new view starts from these numbers. */
  source: BacktestViewSource;
  /** The starting balance to suggest (the backtest's own wallet, if it has one). */
  suggestedBalanceUsd: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (created: BacktestViewDefinition[] | null) => void;
  /** Editing one view instead of creating new ones. Its `addresses` must be loaded. */
  editing?: BacktestViewDefinition;
};

type Combination = { name: string; addresses: string[] };

/**
 * One combination per non-empty line. A line may start with "Name:" (addresses never contain a colon); the addresses are separated by spaces, commas or
 * semicolons. Without a name the server numbers the combination.
 */
export function parseCombinations(text: string): Combination[] {
  const out: Combination[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    const name = colon >= 0 ? line.slice(0, colon).trim() : "";
    const body = colon >= 0 ? line.slice(colon + 1) : line;
    const addresses = [...new Set(body.split(/[\s,;]+/).filter(Boolean))];
    if (addresses.length > 0) out.push({ name, addresses });
  }
  return out;
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
 * Makes combined views of a finished backtest - or edits one. Nothing is simulated: each view re-prices the backtest's stored trades with the trade
 * amount, fees and balance entered here, so the same backtest can be looked at as many ways as wanted without asking pump.fun or the RPC for anything again.
 */
export function NewViewDialog({ runId, source, suggestedBalanceUsd, open, onOpenChange, onSaved, editing }: Props) {
  const [values, setValues] = useState<CombinedValues>(() => initialValues(source, suggestedBalanceUsd, editing));
  const [scope, setScope] = useState<"all" | "listed">(editing ? (editing.allAddresses ? "all" : "listed") : "listed");
  const [name, setName] = useState(editing?.name ?? "");
  const [text, setText] = useState(editing?.addresses?.join("\n") ?? "");
  const [busy, setBusy] = useState(false);

  const numbers = parseCombined(values);
  const combos = useMemo(() => (editing ? [{ name: "", addresses: parseCombinations(text.replace(/\r?\n/g, " ")).flatMap((c) => c.addresses) }] : parseCombinations(text)), [text, editing]);
  const listedOk = scope === "all" || (editing ? combos[0].addresses.length > 0 : combos.length > 0);
  const canSave = !busy && !!numbers && listedOk && (!editing || name.trim().length > 0);
  const totalAddresses = new Set(combos.flatMap((c) => c.addresses)).size;

  async function save() {
    if (!numbers) return;
    const config: BacktestViewConfig = numbers;
    setBusy(true);
    try {
      if (editing) {
        await updateBacktestView(runId, editing._id, { name: name.trim(), addresses: scope === "all" ? [] : combos[0].addresses, config });
        toast.success("Combined view updated");
        onSaved(null);
      } else {
        const views = scope === "all" ? [{ name: name.trim() || undefined }] : combos.map((c) => ({ name: c.name || undefined, addresses: c.addresses }));
        const res = await createBacktestViews(runId, { views, config });
        toast.success(res.views.length === 1 ? `Created "${res.views[0].name}"` : `Created ${res.views.length} combined views`);
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
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-4" /> {editing ? "Edit combined view" : "New combined view"}
          </DialogTitle>
          <DialogDescription>
            Trades this backtest already simulated are re-priced with the amount and fees below and added up on one shared balance. Nothing is fetched or simulated again, so it is instant
            {source.tradeSizeUsd != null && (
              <>
                {" "}
                (the backtest itself used {formatUsd(source.tradeSizeUsd)} per trade, {source.pumpFeePercent ?? 0}% + {formatUsd(source.jitoFeeUsd ?? 0)} fees).
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
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

          {scope === "listed" ? (
            <div className="space-y-1.5">
              <Label htmlFor="bt-view-addresses">{editing ? "Addresses of this combination" : "Combinations - one per line"}</Label>
              <Textarea
                id="bt-view-addresses"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={editing ? 6 : 8}
                spellCheck={false}
                placeholder={editing ? "One address per line (or separated by spaces / commas)" : "Safe 5: addr1 addr2 addr3 addr4 addr5\nGrowth 4: addr1 addr6 addr7 addr8\naddr2, addr3, addr9"}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "Every address must be part of this backtest."
                  : "Each line becomes its own view. Start a line with a name and a colon (\"Safe 5: …\") to name it; addresses are separated by spaces or commas and must all be part of this backtest. The same address may appear in several lines."}
                {combos.length > 0 && !editing && (
                  <span className="mt-0.5 block font-medium text-foreground">
                    {combos.length} combination{combos.length === 1 ? "" : "s"} · {totalAddresses} different address{totalAddresses === 1 ? "" : "es"}
                  </span>
                )}
              </p>
            </div>
          ) : null}

          {(scope === "all" || editing) && (
            <div className="space-y-1.5">
              <Label htmlFor="bt-view-name">Name</Label>
              <Input id="bt-view-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={scope === "all" ? "e.g. Whole backtest at $10" : ""} maxLength={80} />
            </div>
          )}

          <CombinedFields values={values} onChange={setValues} idPrefix="bt-view" recalculated />
          <p className="text-xs text-muted-foreground">
            Same entries and exits as the backtest, new amounts and fees. Stop-loss, take-profit and trailing stops were judged with the backtest&apos;s own fees, so with very different
            fees a trade sitting right at a threshold could have exited a moment earlier or later.
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
            {editing ? "Save" : scope === "listed" && combos.length > 1 ? `Create ${combos.length} views` : "Create view"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
