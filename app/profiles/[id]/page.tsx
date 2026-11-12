"use client";

import { useParams } from "next/navigation";
import { ProfileSettingsForm } from "@/components/settings/profile-settings-form";

/** One profile's strategy settings - view and edit them without having to switch to the profile first. */
export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <ProfileSettingsForm key={id} profileId={id} />;
}
