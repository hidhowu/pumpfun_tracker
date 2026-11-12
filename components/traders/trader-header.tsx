"use client";

import { copyText } from "@/lib/clipboard";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Check, Copy, Pencil, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ManageWalletsMenu } from "@/components/traders/manage-wallets-menu";
import { TraderAvatar } from "@/components/traders/trader-avatar";
import { updateTrader } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TraderDetail } from "@/lib/types";

type Props = {
  trader: TraderDetail;
  onUpdated: (trader: TraderDetail) => void;
};

export function TraderHeader({ trader, onUpdated }: Props) {
  const { currentProfileId } = useProfile();
  const [copied, setCopied] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [labelDraft, setLabelDraft] = useState(trader.label);
  const [notesDraft, setNotesDraft] = useState(trader.notes);
  const [busy, setBusy] = useState(false);
  const blacklisted = trader.status !== "active";

  const copyAddress = async () => {
    if (!(await copyText(trader.address))) {
      toast.error("Couldn't copy the address");
      return;
    }
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 1500);
  };

  const saveLabel = async () => {
    setEditingLabel(false);
    if (labelDraft === trader.label || !currentProfileId) return;
    try {
      const { trader: updated } = await updateTrader(currentProfileId, trader.address, { label: labelDraft });
      onUpdated(updated);
      toast.success("Label updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update label");
      setLabelDraft(trader.label);
    }
  };

  const saveNotes = async () => {
    setEditingNotes(false);
    if (notesDraft === trader.notes || !currentProfileId) return;
    try {
      const { trader: updated } = await updateTrader(currentProfileId, trader.address, { notes: notesDraft });
      onUpdated(updated);
      toast.success("Notes updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update notes");
      setNotesDraft(trader.notes);
    }
  };

  const setMuted = async (muted: boolean) => {
    if (!currentProfileId) return;
    try {
      const { trader: updated } = await updateTrader(currentProfileId, trader.address, { muted });
      onUpdated(updated);
      toast.success(muted ? "Notifications muted for this trader" : "Notifications unmuted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const blacklist = async () => {
    if (!currentProfileId) return;
    setBusy(true);
    try {
      const { trader: updated, closingPositions } = await updateTrader(currentProfileId, trader.address, { status: "blacklisted" });
      onUpdated(updated);
      toast.success(`Trader blacklisted — tracking stopped${closingPositions > 0 ? `, selling ${closingPositions} open position(s)` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to blacklist");
    } finally {
      setBusy(false);
    }
  };

  const unblacklist = async () => {
    if (!currentProfileId) return;
    setBusy(true);
    try {
      const { trader: updated } = await updateTrader(currentProfileId, trader.address, { status: "active" });
      onUpdated(updated);
      toast.success("Trader unblacklisted — tracking resumed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unblacklist");
    } finally {
      setBusy(false);
    }
  };

  const labelEditor = editingLabel ? (
    <Input autoFocus value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} onBlur={saveLabel} onKeyDown={(e) => e.key === "Enter" && saveLabel()} placeholder="Add a label…" className="h-9 w-full max-w-64" />
  ) : (
    <button type="button" onClick={() => setEditingLabel(true)} aria-label="Edit label" className="group flex min-w-0 items-center gap-2 text-left text-xl font-semibold tracking-[-0.02em] hover:text-primary md:text-[28px] md:leading-[34px]">
      <span className="truncate">{trader.label || "Unlabeled trader"}</span>
      <Pencil className="size-4 shrink-0 text-text-3 group-hover:text-primary md:size-[18px]" />
    </button>
  );

  const statusBadge = blacklisted ? (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-destructive/30 bg-neg-soft px-2 text-[11.5px] font-medium text-destructive">Blacklisted</span>
  ) : (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-positive/30 bg-pos-soft px-2 text-[11.5px] font-medium text-positive">
      <span className="size-[7px] rounded-full bg-positive" />
      Active
    </span>
  );

  const notifySwitch = (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="flex h-11 items-center gap-2.5 rounded-full border border-line-2 bg-card px-3.5 md:h-10">
          <span className="text-[13px] text-text-2">
            Notify {trader.mutedOverride === null ? <span className="text-text-3">(default)</span> : null}
          </span>
          <Switch checked={!trader.muted} onCheckedChange={(checked) => setMuted(!checked)} aria-label="Notifications" />
        </label>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px]">
        {trader.mutedOverride === null ? "Inheriting the global notify setting — toggling sets an override just for this trader." : "This trader has an explicit override, independent of the global default."}
      </TooltipContent>
    </Tooltip>
  );

  const blacklistButton = !blacklisted ? (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="lg" disabled={busy} className="max-md:flex-1">
          <Ban />
          Blacklist
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-warn-soft text-warn">
            <Ban />
          </AlertDialogMedia>
          <AlertDialogTitle>Blacklist this trader?</AlertDialogTitle>
          <AlertDialogDescription>Tracking stops now. Open positions (in every profile and wallet) are sold after the usual execution delay. History stays visible under Blacklisted.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={blacklist} className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90">
            Blacklist
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : (
    <Button variant="secondary" size="lg" onClick={unblacklist} disabled={busy} className="max-md:flex-1">
      <ShieldCheck />
      Unblacklist
    </Button>
  );

  const addressRow = (
    <div className="flex items-center gap-1.5">
      <span className="min-w-0 font-mono text-[13px] break-all text-text-2">{trader.address}</span>
      <Button variant="ghost" size="icon-sm" onClick={copyAddress} aria-label="Copy address" className="shrink-0">
        {copied ? <Check className="text-positive" /> : <Copy />}
      </Button>
    </div>
  );

  return (
    <section className={cn("flex flex-col gap-4 rounded-[20px] border bg-card p-4 md:gap-5 md:p-6", blacklisted ? "border-destructive/35" : "border-border")}>
      <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <TraderAvatar address={trader.address} size="xl" className={cn("max-md:size-12 max-md:rounded-[15px] max-md:text-sm", blacklisted && "opacity-70")} />
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {labelEditor}
            {statusBadge}
          </div>
          {addressRow}
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          {notifySwitch}
          <div className="flex w-full items-center gap-2 md:w-auto">
            <ManageWalletsMenu traderAddress={trader.address} label="Add to wallet" disabled={blacklisted} triggerClassName="max-md:flex-1" />
            {blacklistButton}
          </div>
        </div>
      </div>

      {blacklisted && (
        <div className="flex items-start gap-3 rounded-[14px] border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-[13px] text-[#f0d9a6]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <span>A blacklisted trader can&apos;t be added to a wallet.</span>
        </div>
      )}

      <div className="h-px w-full bg-border" />

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Notes</span>
        {editingNotes ? (
          <Textarea
            autoFocus
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={saveNotes}
            placeholder="Add notes about this trader…"
            // Bounded so a large pasted block can't blow up this card's height; scrolls internally instead.
            className="field-sizing-fixed max-h-40 min-h-16 resize-y overflow-y-auto"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingNotes(true)}
            className="flex min-h-11 items-center justify-between gap-3 rounded-[10px] border border-transparent px-2 py-2 text-left text-[13px] text-text-2 hover:border-line-2 hover:bg-surface-2 max-md:rounded-xl max-md:border-dashed max-md:border-line-3 max-md:px-3"
          >
            <span className="min-w-0">{trader.notes || "Click to add notes…"}</span>
            <Pencil className="size-3.5 shrink-0 text-text-3" />
          </button>
        )}
      </div>

      <span className="text-xs text-text-3">
        Tracking since {formatRelativeTime(trader.addedAt)}
        {blacklisted && trader.blacklistedAt && <> · blacklisted {formatRelativeTime(trader.blacklistedAt)}</>}
        {trader.sim.lastActionAt && <> · sim wallet last active {formatRelativeTime(trader.sim.lastActionAt)}</>}
      </span>
    </section>
  );
}
