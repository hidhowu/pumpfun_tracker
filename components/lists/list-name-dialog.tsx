"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName?: string;
  /** Does the API call; throws to keep the dialog open (it shows its own toast). */
  onSubmit: (name: string) => Promise<void>;
};

/** One name field in a dialog: creates a new list or renames an existing one. */
export function ListNameDialog({ open, onOpenChange, ...form }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {/* Mounted only while open, so the field starts from the current name every time. */}
        <NameForm onClose={() => onOpenChange(false)} {...form} />
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ title, submitLabel, initialName = "", onSubmit, onClose }: Omit<DialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const unchanged = trimmed === initialName.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || unchanged || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch {
      // the caller already told the user what went wrong - keep the dialog open so the name can be fixed
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">Type a name for the list.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="list-name">List name</Label>
        <Input id="list-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Core 4" maxLength={60} autoComplete="off" />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed || unchanged || submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
