"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { updateBacktestRun } from "@/lib/backtest-api";
import { useProfile } from "@/lib/profile-context";
import type { BacktestRunDefinition } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

const KEEP = "keep";

type Props = {
  run: Pick<BacktestRunDefinition, "_id" | "name" | "status" | "maxSignatures" | "profileName">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

/**
 * Edit one backtest: its name any time; the signature limit and the strategy
 * (re-copied from a profile) while it is paused, cancelled or finished.
 */
export function EditRunDialog({ run, open, onOpenChange, onSaved }: Props) {
  const { profiles } = useProfile();
  const [name, setName] = useState(run.name);
  const [maxSignatures, setMaxSignatures] = useState(String(run.maxSignatures ?? 0));
  const [profileId, setProfileId] = useState(KEEP);
  const [saving, setSaving] = useState(false);

  const locked = run.status === "queued" || run.status === "running";

  // Start from the run's current values every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(run.name);
    setMaxSignatures(String(run.maxSignatures ?? 0));
    setProfileId(KEEP);
  }, [open, run.name, run.maxSignatures]);

  const limitNumber = maxSignatures === "" ? 0 : Number(maxSignatures);
  const limitValid = Number.isInteger(limitNumber) && limitNumber >= 0;
  const limitChanged = limitNumber !== (run.maxSignatures ?? 0);
  const looser = limitChanged && (run.maxSignatures ?? 0) > 0 && (limitNumber === 0 || limitNumber > (run.maxSignatures ?? 0));
  const nameChanged = name.trim() !== run.name && name.trim() !== "";
  const recopy = profileId !== KEEP;
  const dirty = nameChanged || (!locked && (limitChanged || recopy));

  async function save() {
    if (!limitValid) {
      toast.error("The signature limit must be a whole number (0 = no limit)");
      return;
    }
    setSaving(true);
    try {
      const res = await updateBacktestRun(run._id, {
        ...(nameChanged ? { name: name.trim() } : {}),
        ...(!locked && limitChanged ? { maxSignatures: limitNumber } : {}),
        ...(!locked && recopy ? { profileId } : {}),
      });
      const parts = ["Backtest updated"];
      if (res.requeuedSkipped > 0) parts.push(`${res.requeuedSkipped} skipped address${res.requeuedSkipped === 1 ? "" : "es"} queued again`);
      if (res.resimulated) parts.push("results cleared - every address will be simulated again");
      if ((res.requeuedSkipped > 0 || res.resimulated) && res.run.status === "paused") parts.push("press Resume to run it");
      toast.success(parts.join(" · "));
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update the backtest");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit backtest</DialogTitle>
          <DialogDescription>
            {locked ? "Pause the backtest to change its settings - only the name can be edited while it runs." : "Changes apply when you resume or re-run the backtest."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-bt-name">Name</Label>
            <Input id="edit-bt-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-bt-max">Skip addresses with more signatures than</Label>
            <Input
              id="edit-bt-max"
              inputMode="numeric"
              disabled={locked}
              value={maxSignatures}
              onChange={(e) => setMaxSignatures(e.target.value.replace(/[^0-9]/g, ""))}
              className={cn("w-32", !limitValid && "border-negative")}
              aria-invalid={!limitValid}
            />
            <p className="text-xs text-muted-foreground">
              0 = no limit. {looser ? "Addresses that were skipped for being over the old limit are queued again." : "Raising it queues the addresses skipped for being over the old limit again."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-bt-profile">Strategy</Label>
            <Select value={profileId} onValueChange={setProfileId} disabled={locked}>
              <SelectTrigger id="edit-bt-profile" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Keep the current strategy (from &quot;{run.profileName}&quot;)</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    Copy the current settings of &quot;{p.name}&quot;
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recopy && (
              <p className="flex items-start gap-1.5 text-xs text-amber-500">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Results so far were simulated with the old settings, so they are cleared and every address is simulated again. Transactions already collected are reused, so this is much faster than the first run.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={saving || !dirty || !limitValid}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
