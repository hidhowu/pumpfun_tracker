"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Layers, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileSettingsForm } from "@/components/settings/profile-settings-form";
import { renameProfile } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";

/** One profile's strategy settings - view and edit them without having to switch to the profile first. */
export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profiles, currentProfileId, setCurrentProfileId, loading, refresh } = useProfile();
  const profile = profiles.find((p) => p._id === id);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  async function handleRename() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!profile || !trimmed || trimmed === profile.name) return;
    try {
      await renameProfile(id, trimmed);
      await refresh();
      toast.success("Profile renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename profile");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit -ml-2 text-muted-foreground">
        <Link href="/profiles">
          <ArrowLeft className="size-4" /> Back to profiles
        </Link>
      </Button>

      {loading && !profile ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !profile ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Profile not found.</div>
      ) : (
        <>
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Layers className="size-4.5" />
              </div>
              {editingName ? (
                <Input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => e.key === "Enter" && handleRename()}
                  className="h-8 w-56"
                />
              ) : (
                <button
                  type="button"
                  title="Click to rename"
                  onClick={() => {
                    setNameDraft(profile.name);
                    setEditingName(true);
                  }}
                  className="truncate text-lg font-semibold tracking-tight hover:text-primary"
                >
                  {profile.name}
                </button>
              )}
              {profile.isDefault && (
                <Badge className="gap-1 border-primary/30 bg-primary/15 text-primary">
                  <Star className="size-3" /> Default
                </Badge>
              )}
              {profile._id === currentProfileId && <Badge variant="outline">Viewing</Badge>}
            </div>
            {profile._id !== currentProfileId && (
              <Button variant="outline" size="sm" onClick={() => setCurrentProfileId(profile._id)}>
                Switch to this profile
              </Button>
            )}
          </div>

          <ProfileSettingsForm
            key={profile._id}
            profileId={profile._id}
            title="Profile settings"
            description={`The strategy defaults used by "${profile.name}". Changes only affect this profile - any trader can still override them individually.`}
          />
        </>
      )}
    </div>
  );
}
