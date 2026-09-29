"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TraderTable } from "@/components/traders/trader-table";
import { listTraders, updateTrader } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import type { Trader } from "@/lib/types";

const POLL_INTERVAL_MS = 15000;

export default function BlacklistedPage() {
  const { currentProfileId } = useProfile();
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { traders } = await listTraders(currentProfileId, "blacklisted");
      setTraders(traders);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentProfileId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleBlacklistToggle(address: string, blacklist: boolean) {
    if (!currentProfileId) return;
    try {
      await updateTrader(currentProfileId, address, { status: blacklist ? "blacklisted" : "active" });
      toast.success(blacklist ? "Trader blacklisted" : "Trader unblacklisted - tracking resumes");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update trader");
    }
  }

  async function handleMuteToggle(address: string, muted: boolean | null) {
    if (!currentProfileId) return;
    try {
      await updateTrader(currentProfileId, address, { muted });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update notifications");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Blacklisted</h1>
        <p className="text-sm text-muted-foreground">
          Tracking is fully stopped for these wallets, but every trade and stat
          collected before they were blacklisted stays visible below. Unblacklist
          to resume tracking - nothing here was ever deleted.
        </p>
      </div>

      <TraderTable
        traders={traders}
        mode="blacklisted"
        loading={loading}
        onBlacklistToggle={handleBlacklistToggle}
        onMuteToggle={handleMuteToggle}
        emptyMessage="No blacklisted traders."
      />
    </div>
  );
}
