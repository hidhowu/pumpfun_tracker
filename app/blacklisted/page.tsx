"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { TraderTable } from "@/components/traders/trader-table";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { listTraders, updateTrader } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import type { Trader } from "@/lib/types";

const POLL_INTERVAL_MS = 15000;

export default function BlacklistedPage() {
  const { currentProfileId } = useProfile();
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { traders } = await listTraders(currentProfileId, "blacklisted");
      setTraders(traders);
      setRefreshError(false);
    } catch (err) {
      console.error(err);
      setRefreshError(true);
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
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div>
        <h1 className="hidden text-[28px] leading-[34px] font-semibold tracking-[-0.025em] md:block">
          Blacklisted
          <HelpTip>Tracking is stopped, but earlier trades and stats stay visible. Unblacklist to resume.</HelpTip>
        </h1>
        <p className="text-sm text-text-2 md:hidden">Tracking is stopped. Earlier trades and stats stay visible.</p>
      </div>

      {refreshError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <b>Couldn&apos;t refresh the list.</b> Showing the last data received. Retrying every {POLL_INTERVAL_MS / 1000} s.
          </span>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Retry now
          </Button>
        </div>
      )}

      <TraderTable
        traders={traders}
        mode="blacklisted"
        loading={loading}
        onBlacklistToggle={handleBlacklistToggle}
        onMuteToggle={handleMuteToggle}
        onListsChanged={refresh}
        emptyMessage="No blacklisted traders."
      />
    </div>
  );
}
