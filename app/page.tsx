"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, Layers, Wallet, Coins } from "lucide-react";
import { TraderTable } from "@/components/traders/trader-table";
import { AddTraderDialog } from "@/components/traders/add-trader-dialog";
import { StatTile } from "@/components/traders/stat-tile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listTraderLists, listTraders, updateTrader } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useProfile } from "@/lib/profile-context";
import type { Trader, TraderListView } from "@/lib/types";

const POLL_INTERVAL_MS = 8000;
const ALL_TRADERS_VALUE = "__all__"; // Select can't use "" as an item value, so this stands in for "no list filter"

export default function DashboardPage() {
  const { currentProfileId } = useProfile();
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<TraderListView[]>([]);
  const [listId, setListId] = useState<string>(ALL_TRADERS_VALUE);

  const refresh = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { traders } = await listTraders(currentProfileId, "active", listId === ALL_TRADERS_VALUE ? undefined : listId);
      setTraders(traders);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentProfileId, listId]);

  const refreshLists = useCallback(async () => {
    try {
      const { lists } = await listTraderLists();
      setLists(lists);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  async function handleBlacklistToggle(address: string, blacklist: boolean) {
    if (!currentProfileId) return;
    try {
      await updateTrader(currentProfileId, address, { status: blacklist ? "blacklisted" : "active" });
      toast.success(blacklist ? "Trader blacklisted" : "Trader unblacklisted");
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

  // All four headline numbers are about OUR simulated wallets - never the
  // tracked wallets' own on-chain volume/PnL.
  const totalOpenPositions = traders.reduce((sum, t) => sum + (t.sim.openPositionCount || 0), 0);
  const combinedBalance = traders.reduce((sum, t) => sum + (t.sim.balanceUsd || 0), 0);
  const combinedRealizedPnl = traders.reduce((sum, t) => sum + (t.sim.realizedPnlUsd || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Traders</h1>
        <p className="text-sm text-muted-foreground">
          Wallets currently being tracked for pump.fun buy/sell signals - all figures below are our own simulated copy-trade performance.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active traders" value={String(traders.length)} icon={Users} />
        <StatTile label="Total open positions" value={String(totalOpenPositions)} icon={Layers} />
        <StatTile label="Combined sim balance" value={formatUsd(combinedBalance)} icon={Wallet} />
        <StatTile
          label="Combined realized PnL"
          value={formatUsd(combinedRealizedPnl)}
          icon={Coins}
          tone={combinedRealizedPnl > 0 ? "positive" : combinedRealizedPnl < 0 ? "negative" : "default"}
        />
      </div>

      {/* flex-wrap: the count text + list-filter Select + Add Trader button
          comfortably exceed a phone viewport's width combined - this lets
          them stack onto a second line instead of overflowing horizontally. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {traders.length} trader{traders.length === 1 ? "" : "s"} tracked
          </span>
          <Select value={listId} onValueChange={setListId}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue placeholder="All traders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TRADERS_VALUE}>All traders</SelectItem>
              {lists.map((list) => (
                <SelectItem key={list._id} value={list._id}>
                  {list.name} ({list.memberCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <AddTraderDialog onAdded={refresh} />
      </div>

      <TraderTable
        traders={traders}
        mode="active"
        loading={loading}
        onBlacklistToggle={handleBlacklistToggle}
        onMuteToggle={handleMuteToggle}
        onListsChanged={() => {
          refresh();
          refreshLists();
        }}
        emptyMessage="No traders tracked yet - add one to get started."
      />
    </div>
  );
}
