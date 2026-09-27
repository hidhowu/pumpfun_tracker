"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, Layers, Wallet, Coins } from "lucide-react";
import { TraderTable } from "@/components/traders/trader-table";
import { AddTraderDialog } from "@/components/traders/add-trader-dialog";
import { StatTile } from "@/components/traders/stat-tile";
import { listTraders, updateTrader } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import type { Trader } from "@/lib/types";

const POLL_INTERVAL_MS = 8000;

export default function DashboardPage() {
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { traders } = await listTraders("active");
      setTraders(traders);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleBlacklistToggle(address: string, blacklist: boolean) {
    try {
      await updateTrader(address, { status: blacklist ? "blacklisted" : "active" });
      toast.success(blacklist ? "Trader blacklisted" : "Trader unblacklisted");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update trader");
    }
  }

  async function handleMuteToggle(address: string, muted: boolean | null) {
    try {
      await updateTrader(address, { muted });
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

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {traders.length} trader{traders.length === 1 ? "" : "s"} tracked
        </span>
        <AddTraderDialog onAdded={refresh} />
      </div>

      <TraderTable
        traders={traders}
        mode="active"
        loading={loading}
        onBlacklistToggle={handleBlacklistToggle}
        onMuteToggle={handleMuteToggle}
        emptyMessage="No traders tracked yet - add one to get started."
      />
    </div>
  );
}
