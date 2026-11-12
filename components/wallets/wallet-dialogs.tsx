"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Info, Loader2, Plus, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createWallet, duplicateWallet } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { WalletView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The round icon at the head of a dialog (the design's "dlg-ic"). */
function DialogIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-primary">{children}</span>;
}

function MoneyInput({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-3">$</span>
      <Input id={id} type="number" min={1} step={10} value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} className="pl-7 max-md:h-11" />
    </div>
  );
}

/** "Create sim wallet" button + its dialog. `className` styles the trigger (the page shows it in the header, on the empty state and as a phone button). */
export function CreateWalletDialog({ onCreated, triggerClassName, label = "Create sim wallet", size }: { onCreated: () => void; triggerClassName?: string; label?: string; size?: "default" | "lg" | "sm" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} className={cn("gap-1.5", triggerClassName)} onClick={() => setOpen(true)}>
        <Plus className="size-4" strokeWidth={2.2} />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <CreateForm
            onClose={() => setOpen(false)}
            onCreated={() => {
              setOpen(false);
              onCreated();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [startingBalanceUsd, setStartingBalanceUsd] = useState("100");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    const balance = Number(startingBalanceUsd);
    if (!trimmed) {
      toast.error("Enter a wallet name");
      return;
    }
    if (!Number.isFinite(balance) || balance <= 0) {
      toast.error("Enter a positive starting balance");
      return;
    }
    setSubmitting(true);
    try {
      await createWallet(trimmed, balance);
      toast.success(`Wallet "${trimmed}" created`);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create wallet");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader className="flex-row items-center gap-3">
        <DialogIcon>
          <WalletIcon className="size-5" />
        </DialogIcon>
        <DialogTitle>
          Create a wallet
          <HelpTip>A second, fully independent simulation with its own balance and settings, starting from zero.</HelpTip>
        </DialogTitle>
        <DialogDescription className="sr-only">Name the wallet and set its starting balance.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wallet-name">Name</Label>
        <Input id="wallet-name" autoFocus placeholder="e.g. High conviction picks" value={name} onChange={(e) => setName(e.target.value)} className="max-md:h-11" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wallet-balance">
          Starting balance
          <HelpTip>Fixed: this wallet can never go negative. A trade it can&apos;t afford is skipped.</HelpTip>
        </Label>
        <MoneyInput id="wallet-balance" value={startingBalanceUsd} onChange={setStartingBalanceUsd} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Rows of the "what to carry over" list: a title, an optional help tip and the switch. */
function CopyRow({ title, help, checked, onChange, highlight }: { title: string; help?: string; checked: boolean; onChange: (v: boolean) => void; highlight?: boolean }) {
  return (
    <div className={cn("flex min-h-[52px] items-center justify-between gap-4 rounded-[14px] border bg-surface-2 px-3.5 py-3", highlight ? "border-volt-line" : "border-border")}>
      <b className="text-[13px] font-semibold">
        {title}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </b>
      <Switch aria-label={title} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** "Duplicate" button + its dialog, seeded from `source` every time it opens. */
export function DuplicateWalletDialog({ source, onDuplicated, triggerClassName }: { source: WalletView; onDuplicated: () => void; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className={cn("gap-1.5 text-text-2", triggerClassName)} onClick={() => setOpen(true)}>
        <Copy className="size-3.5" /> Duplicate
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DuplicateForm
            source={source}
            onClose={() => setOpen(false)}
            onDuplicated={() => {
              setOpen(false);
              onDuplicated();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DuplicateForm({ source, onClose, onDuplicated }: { source: WalletView; onClose: () => void; onDuplicated: () => void }) {
  const [name, setName] = useState(`${source.name} copy`);
  const [startingBalanceUsd, setStartingBalanceUsd] = useState(String(source.startingBalanceUsd));
  const [copySettings, setCopySettings] = useState(true);
  const [copyTraders, setCopyTraders] = useState(true);
  const [copyTrades, setCopyTrades] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a wallet name");
      return;
    }
    const balance = Number(startingBalanceUsd);
    if (!copyTrades && (!Number.isFinite(balance) || balance <= 0)) {
      toast.error("Enter a positive starting balance");
      return;
    }
    setSubmitting(true);
    try {
      await duplicateWallet(source._id, { name: trimmed, startingBalanceUsd: balance, copySettings, copyTraders, copyTrades });
      toast.success(`Wallet "${trimmed}" created from "${source.name}"`);
      onDuplicated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to duplicate wallet");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader className="flex-row items-center gap-3">
        <DialogIcon>
          <Copy className="size-5" />
        </DialogIcon>
        <DialogTitle>
          Duplicate &quot;{source.name}&quot;
          <HelpTip>Creates a new independent wallet. Pick what to carry over.</HelpTip>
        </DialogTitle>
        <DialogDescription className="sr-only">Choose what to copy into the new wallet.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dup-wallet-name">Name</Label>
        <Input id="dup-wallet-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className="max-md:h-11" />
      </div>
      <div className="flex flex-col gap-2">
        <CopyRow title="Copy settings" help="Trade size, fees, stop-loss and take-profit, trailing stops and the rest." checked={copySettings} onChange={setCopySettings} />
        <CopyRow
          title="Copy traders"
          help={`Assigns the same ${source.traderCount ?? 0} trader${source.traderCount === 1 ? "" : "s"}; the new wallet starts watching them with a clean slate.`}
          checked={copyTraders}
          onChange={setCopyTraders}
        />
        <CopyRow
          title="Copy trade history"
          help="Forks every open and closed position and the current balance: an exact snapshot."
          checked={copyTrades}
          onChange={setCopyTrades}
          highlight={copyTrades}
        />
      </div>
      {copyTrades ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-info/30 bg-info-soft px-3 py-2.5 text-xs leading-[18px] text-[#c7e2ff]">
          <Info className="mt-px size-3.5 shrink-0 text-info" />
          <span>
            Using &quot;{source.name}&quot;&apos;s exact current balance ({formatUsd(source.balanceUsd)} of {formatUsd(source.startingBalanceUsd)}) instead, since trade history is being copied.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dup-wallet-balance">Starting balance</Label>
          <MoneyInput id="dup-wallet-balance" value={startingBalanceUsd} onChange={setStartingBalanceUsd} />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          Duplicate
        </Button>
      </DialogFooter>
    </form>
  );
}
