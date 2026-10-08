"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Copy, Check, ShieldBan, ShieldCheck, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ManageWalletsMenu } from "@/components/traders/manage-wallets-menu";
import { updateTrader } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatRelativeTime } from "@/lib/format";
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

  const copyAddress = async () => {
    await navigator.clipboard.writeText(trader.address);
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
      toast.success(
        `Trader blacklisted — tracking stopped${closingPositions > 0 ? `, selling ${closingPositions} open position(s)` : ""}`
      );
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

  return (
    <Card className="border-border/60">
      <CardContent className="flex flex-col gap-5 pt-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              {editingLabel ? (
                <Input
                  autoFocus
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onBlur={saveLabel}
                  onKeyDown={(e) => e.key === "Enter" && saveLabel()}
                  placeholder="Add a label…"
                  className="h-8 w-56"
                />
              ) : (
                <button
                  onClick={() => setEditingLabel(true)}
                  className="group flex items-center gap-1.5 text-lg font-semibold tracking-tight hover:text-primary"
                >
                  {trader.label || "Unlabeled trader"}
                  <Pencil className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                </button>
              )}
              <Badge variant={trader.status === "active" ? "secondary" : "destructive"} className="capitalize">
                {trader.status}
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <span>{trader.address}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={copyAddress}
                    className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                    aria-label="Copy address"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy address</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {trader.mutedOverride === null ? "Notify (default)" : "Notify"}
                  </span>
                  <Switch checked={!trader.muted} onCheckedChange={(checked) => setMuted(!checked)} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {trader.mutedOverride === null
                  ? "Inheriting the global notify setting — toggling sets an override just for this trader."
                  : "This trader has an explicit override, independent of the global default."}
              </TooltipContent>
            </Tooltip>

            <ManageWalletsMenu traderAddress={trader.address} />

            {trader.status === "active" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={busy}>
                    <ShieldBan className="size-4" /> Blacklist
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Blacklist this trader?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tracking stops immediately — no new trades will be recorded until you unblacklist them.
                      Every open position from this trader (in every profile and wallet) is sold, after the usual execution delay.
                      Their existing history is kept and still visible from the Blacklisted section.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={blacklist} className="bg-negative text-negative-foreground hover:bg-negative/90">
                      Blacklist
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button variant="secondary" size="sm" onClick={unblacklist} disabled={busy}>
                <ShieldCheck className="size-4" /> Unblacklist
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Notes</span>
          {editingNotes ? (
            <Textarea
              autoFocus
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={saveNotes}
              placeholder="Add notes about this trader…"
              // Same field-sizing:content issue as the bulk-paste dialogs -
              // bounded here too so a large pasted block can't blow up this
              // card's height; scrolls internally instead.
              className="field-sizing-fixed max-h-40 min-h-16 resize-y overflow-y-auto"
            />
          ) : (
            <button
              onClick={() => setEditingNotes(true)}
              className="min-h-9 rounded-md border border-transparent px-2 py-1.5 text-left text-sm text-muted-foreground hover:border-border hover:bg-muted/40"
            >
              {trader.notes || "Click to add notes…"}
            </button>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          Tracking since {formatRelativeTime(trader.addedAt)}
          {trader.status === "blacklisted" && trader.blacklistedAt && (
            <> · blacklisted {formatRelativeTime(trader.blacklistedAt)}</>
          )}
          {trader.sim.lastActionAt && <> · sim wallet last active {formatRelativeTime(trader.sim.lastActionAt)}</>}
        </div>
      </CardContent>
    </Card>
  );
}
