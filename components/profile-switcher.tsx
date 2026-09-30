"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, Plus, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useProfile } from "@/lib/profile-context";
import { createProfile, deleteProfile } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

function CreateProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { profiles, currentProfileId, refresh, setCurrentProfileId } = useProfile();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"fresh" | "clone">("fresh");
  const [sourceProfileId, setSourceProfileId] = useState(currentProfileId ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a profile name");
      return;
    }
    setSubmitting(true);
    try {
      const { profile } = await createProfile(trimmed, mode, sourceProfileId || undefined);
      toast.success(`Profile "${trimmed}" created`);
      await refresh();
      setCurrentProfileId(profile._id);
      setName("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create profile");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new profile</DialogTitle>
          <DialogDescription>
            An independent strategy over the same tracked wallets - its own settings and simulated trades, so you can
            compare strategies against each other.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              placeholder="e.g. 30-min time stop"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Starting point</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("fresh")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  mode === "fresh" ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/40"
                )}
              >
                <div className="text-sm font-medium">Fresh</div>
                <div className="text-xs text-muted-foreground">Copy settings only - clean simulated wallet</div>
              </button>
              <button
                type="button"
                onClick={() => setMode("clone")}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left transition-colors",
                  mode === "clone" ? "border-primary bg-primary/10" : "border-border/60 hover:bg-muted/40"
                )}
              >
                <div className="text-sm font-medium">Clone</div>
                <div className="text-xs text-muted-foreground">Fork current state exactly, then diverge</div>
              </button>
            </div>
          </div>

          {profiles.length > 1 && (
            <div className="space-y-1.5">
              <Label>{mode === "clone" ? "Fork from" : "Copy settings from"}</Label>
              <Select value={sourceProfileId} onValueChange={setSourceProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProfileDialog({ profile, onOpenChange }: { profile: Profile | null; onOpenChange: (open: boolean) => void }) {
  const { profiles, currentProfileId, refresh, setCurrentProfileId } = useProfile();
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete() {
    if (!profile) return;
    setSubmitting(true);
    try {
      await deleteProfile(profile._id);
      toast.success(`Profile "${profile.name}" deleted`);
      // Default can never be the one just deleted (the backend rejects
      // that) - always exists as a safe fallback if we were looking at the
      // now-deleted profile.
      if (currentProfileId === profile._id) {
        const defaultProfile = profiles.find((p) => p.isDefault);
        if (defaultProfile) setCurrentProfileId(defaultProfile._id);
      }
      await refresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete profile");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={!!profile} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &quot;{profile?.name}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes this profile&apos;s settings and every simulated trade/position under it. The
            tracked wallets themselves and their real on-chain history are untouched - this only removes this
            profile&apos;s own simulated strategy state.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-negative text-negative-foreground hover:bg-negative/90"
            disabled={submitting}
            onClick={handleDelete}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ProfileSwitcher() {
  const { profiles, currentProfile, currentProfileId, setCurrentProfileId, loading } = useProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);

  if (loading) {
    return <div className="h-8 w-36 animate-pulse rounded-md bg-muted" />;
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <span className="max-w-[10rem] truncate">{currentProfile?.name ?? "Select profile"}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Profiles</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profiles.map((profile) => {
            // Deleting is only offered when it's actually possible (the
            // backend also enforces both of these - this just avoids
            // showing an action that's guaranteed to fail).
            const canDelete = !profile.isDefault && profiles.length > 1;
            return (
              <DropdownMenuItem
                key={profile._id}
                // Prevents Radix's default "select and close" for this item
                // - required so the nested delete button's own click can be
                // handled separately without the menu closing first. The
                // "switch profile" action below closes the menu itself.
                onSelect={(e) => e.preventDefault()}
                className="justify-between gap-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    setCurrentProfileId(profile._id);
                    setMenuOpen(false);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span className="truncate">{profile.name}</span>
                  {profile._id === currentProfileId && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      setDeleteTarget(profile);
                    }}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-negative"
                    aria-label={`Delete ${profile.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="size-3.5" /> Create new profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProfileDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DeleteProfileDialog profile={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} />
    </>
  );
}
