"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
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
import { useProfile } from "@/lib/profile-context";
import { createProfile } from "@/lib/api";
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

export function ProfileSwitcher() {
  const { profiles, currentProfile, currentProfileId, setCurrentProfileId, loading } = useProfile();
  const [createOpen, setCreateOpen] = useState(false);

  if (loading) {
    return <div className="h-8 w-36 animate-pulse rounded-md bg-muted" />;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <span className="max-w-[10rem] truncate">{currentProfile?.name ?? "Select profile"}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Profiles</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {profiles.map((profile) => (
            <DropdownMenuItem key={profile._id} onClick={() => setCurrentProfileId(profile._id)} className="justify-between">
              <span className="truncate">{profile.name}</span>
              {profile._id === currentProfileId && <Check className="size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="size-3.5" /> Create new profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProfileDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
