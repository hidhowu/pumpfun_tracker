"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Users, Layers, Wallet, TrendingUp, TriangleAlert, ListChecks, ArrowUp, ArrowDown } from "lucide-react";
import { TraderTable } from "@/components/traders/trader-table";
import { AddTraderDialog } from "@/components/traders/add-trader-dialog";
import { ExportCsvDialog } from "@/components/export-csv-dialog";
import { StatTile } from "@/components/traders/stat-tile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { listTraderLists, listTraders, updateTrader } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useProfile } from "@/lib/profile-context";
import { cn } from "@/lib/utils";
import type { Trader, TraderListView } from "@/lib/types";

const POLL_INTERVAL_MS = 8000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ALL_TRADERS_VALUE = "__all__"; // Select can't use "" as an item value, so this stands in for "no list filter"

function blacklistCloseSummary(closing: number) {
  return closing > 0 ? ` - selling ${closing} open position${closing === 1 ? "" : "s"} (after the execution delay)` : "";
}

export default function DashboardPage() {
  const { currentProfileId, currentProfile } = useProfile();
  const [traders, setTraders] = useState<Trader[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState(false);
  // Time of the last successful poll - the "added this week" cut-off is measured from it (no clock reads while rendering).
  const [polledAt, setPolledAt] = useState(0);
  const [lists, setLists] = useState<TraderListView[]>([]);
  const [listId, setListId] = useState<string>(ALL_TRADERS_VALUE);

  const refresh = useCallback(async () => {
    if (!currentProfileId) return;
    try {
      const { traders } = await listTraders(currentProfileId, "active", listId === ALL_TRADERS_VALUE ? undefined : listId);
      setTraders(traders);
      setRefreshError(false);
      setPolledAt(Date.now());
    } catch (err) {
      console.error(err);
      setRefreshError(true);
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
      const { closingPositions } = await updateTrader(currentProfileId, address, { status: blacklist ? "blacklisted" : "active" });
      toast.success(blacklist ? `Trader blacklisted${blacklistCloseSummary(closingPositions)}` : "Trader unblacklisted");
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

  async function handleBulkBlacklist(addresses: string[]) {
    if (!currentProfileId) return;
    let closing = 0;
    let failed = 0;
    for (const address of addresses) {
      try {
        const res = await updateTrader(currentProfileId, address, { status: "blacklisted" });
        closing += res.closingPositions;
      } catch {
        failed += 1;
      }
    }
    const done = addresses.length - failed;
    if (done > 0) toast.success(`${done} trader${done === 1 ? "" : "s"} blacklisted${blacklistCloseSummary(closing)}`);
    if (failed > 0) toast.error(`${failed} trader${failed === 1 ? "" : "s"} could not be blacklisted`);
    await refresh();
  }

  // All four headline numbers are about OUR simulated wallets - never the
  // tracked wallets' own on-chain volume/PnL.
  const totalOpenPositions = traders.reduce((sum, t) => sum + (t.sim.openPositionCount || 0), 0);
  const tradersWithOpen = traders.filter((t) => (t.sim.openPositionCount || 0) > 0).length;
  const combinedBalance = traders.reduce((sum, t) => sum + (t.sim.balanceUsd || 0), 0);
  const combinedRealizedPnl = traders.reduce((sum, t) => sum + (t.sim.realizedPnlUsd || 0), 0);
  const todayPnl = traders.reduce((sum, t) => sum + (t.today.actualizedUsd ?? 0), 0);
  const addedThisWeek = traders.filter((t) => new Date(t.addedAt).getTime() >= polledAt - WEEK_MS).length;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="hidden text-[28px] leading-[34px] font-semibold tracking-[-0.025em] md:block">
          Traders
          <HelpTip>Wallets tracked for buy and sell signals. Figures are your simulated copy-trade results, not on-chain P&amp;L.</HelpTip>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {currentProfileId && (
            <ExportCsvDialog
              endpoint={`/api/profiles/${currentProfileId}/export`}
              title={`Export profile${currentProfile ? ` "${currentProfile.name}"` : ""}`}
              description="Every active (non-blacklisted) trader's simulated trades under this profile's settings - per hour, per day, or per trade, with a per-trader summary (win rate, P&L, win/loss days)."
            />
          )}
          <AddTraderDialog onAdded={refresh} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatTile label="Active traders" value={String(traders.length)} icon={Users} hint={addedThisWeek > 0 ? `${addedThisWeek} added this week` : undefined} />
        <StatTile label="Open positions" value={String(totalOpenPositions)} icon={Layers} hint={totalOpenPositions > 0 ? `across ${tradersWithOpen} trader${tradersWithOpen === 1 ? "" : "s"}` : undefined} />
        <StatTile label="Combined sim balance" value={formatUsd(combinedBalance)} icon={Wallet} hint="available cash" />
        <StatTile
          label="Combined realized P&L"
          value={formatUsd(combinedRealizedPnl)}
          icon={TrendingUp}
          tone={combinedRealizedPnl > 0 ? "positive" : combinedRealizedPnl < 0 ? "negative" : "default"}
          hint={
            Math.abs(todayPnl) >= 0.005 ? (
              <>
                {todayPnl > 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                {formatUsd(Math.abs(todayPnl))} today
              </>
            ) : undefined
          }
          hintTone={todayPnl > 0 ? "positive" : "negative"}
        />
      </div>

      {refreshError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <b>Couldn&apos;t refresh traders.</b>{" "}
            Showing the last data received. Retrying every {POLL_INTERVAL_MS / 1000} s.
          </span>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            Retry now
          </Button>
        </div>
      )}

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
        onBulkBlacklist={handleBulkBlacklist}
        emptyMessage="No traders tracked yet - add one to get started."
        toolbar={
          <>
            {/* Desktop: one chip that opens the list menu. */}
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger
                aria-label="Filter by list"
                className={cn(
                  "hidden h-8 w-auto gap-2 rounded-full px-3 text-[13px] md:flex",
                  listId === ALL_TRADERS_VALUE ? "border-line-2 bg-card text-text-2 hover:text-foreground" : "border-volt-line bg-volt-soft text-primary"
                )}
              >
                <ListChecks className="size-3.5" />
                <span>
                  List: <SelectValue placeholder="All traders" />
                </span>
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
            {/* Phone: a row of chips that scrolls sideways. */}
            <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 md:hidden" role="group" aria-label="Filter by list">
              {[{ _id: ALL_TRADERS_VALUE, name: "All traders", memberCount: null as number | null }, ...lists].map((list) => (
                <button
                  key={list._id}
                  type="button"
                  aria-pressed={listId === list._id}
                  onClick={() => setListId(list._id)}
                  className={cn(
                    "inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-[13px] whitespace-nowrap transition-colors",
                    listId === list._id ? "border-volt-line bg-volt-soft text-primary" : "border-line-2 bg-card text-text-2"
                  )}
                >
                  {list.name}
                  {list.memberCount !== null ? ` (${list.memberCount})` : ""}
                </button>
              ))}
            </div>
          </>
        }
      />
    </div>
  );
}
