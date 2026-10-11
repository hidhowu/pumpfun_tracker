"use client";

import { ProfileSettingsForm } from "@/components/settings/profile-settings-form";
import { useProfile } from "@/lib/profile-context";

/** Settings of the currently-selected profile - see /profiles/[id] for any other profile's. */
export default function SettingsPage() {
  const { currentProfileId } = useProfile();
  if (!currentProfileId) return null;
  return <ProfileSettingsForm key={currentProfileId} profileId={currentProfileId} />;
}
