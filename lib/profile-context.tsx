"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listProfiles } from "./api";
import type { Profile } from "./types";

const STORAGE_KEY = "pumpfun-tracker.currentProfileId";

type ProfileContextValue = {
  profiles: Profile[];
  currentProfileId: string | null;
  currentProfile: Profile | null;
  loading: boolean;
  setCurrentProfileId: (id: string) => void;
  refresh: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfileId, setCurrentProfileIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { profiles } = await listProfiles();
    setProfiles(profiles);
    setCurrentProfileIdState((prev) => {
      if (prev && profiles.some((p) => p._id === prev)) return prev;
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(STORAGE_KEY);
      } catch {
        // ignore - private window / blocked storage
      }
      if (stored && profiles.some((p) => p._id === stored)) return stored;
      return profiles.find((p) => p.isDefault)?._id ?? profiles[0]?._id ?? null;
    });
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  function setCurrentProfileId(id: string) {
    setCurrentProfileIdState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  const currentProfile = profiles.find((p) => p._id === currentProfileId) ?? null;

  return (
    <ProfileContext.Provider value={{ profiles, currentProfileId, currentProfile, loading, setCurrentProfileId, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}
