"use client";

import { CopyButton } from "@/components/copy-button";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Loader2, UserMinus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TraderAvatar } from "@/components/traders/trader-avatar";
import { AddTradersToWalletDialog } from "./add-traders-to-wallet-dialog";
import { WalletTradersDailyTable } from "./wallet-traders-daily-table";
import { getWalletTraders, removeTradersFromWallet } from "@/lib/api";
import { formatAddress, formatRelativeTime, formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { WalletTraderPerformance } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = { walletId: string; /** Called after traders are added or removed, so the page can refresh its trader count. */ onChanged?: () => void };
type Period = "day" | "week" | "month";
type View = "overview" | "daily";

const VIEWS = [
  { value: "overview", label: "Overview" },
  { value: "daily", label: "Last 7 days" },
] as const;
const PERIODS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : "text-text-3");
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;
const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

function AddressChip({ address }: { address: string }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
      <a href={`/traders/${address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        {formatAddress(address, 5)}
        <ArrowUpRight className="size-3" />
      </a>
      <CopyButton value={address} label="address" />
    </span>
  );
}

/**
 * Assigned traders and how they've performed ON THIS WALLET specifically -
 * every figure here (lifetime AND period) is scoped to trades made only
 * while a trader has been on this wallet, never their overall/lifetime
 * stats. A trader with a 1000% lifetime return elsewhere starts at zero here.
 */
export function WalletTradersTab({ walletId, onChanged }: Props) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const [period, setPeriod] = useState<Period>("day");
  const [view, setView] = useState<View>("overview");
  const [dailyRefreshKey, setDailyRefreshKey] = useState(0);
  const [traders, setTraders] = useState<WalletTraderPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  // The trader whose "Remove" confirmation is open (one dialog for the whole tab).
  const [confirmAddress, setConfirmAddress] = useState<string | null>(null);

  const refresh = useCallback(
    async (p: Period) => {
      setLoading(true);
      try {
        const res = await getWalletTraders(walletId, p);
        setTraders(res.traders);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load traders");
      } finally {
        setLoading(false);
      }
    },
    [walletId]
  );

  useEffect(() => {
    refresh(period);
  }, [refresh, period]);

  async function handleRemove(address: string) {
    setPendingAddress(address);
    try {
      await removeTradersFromWallet(walletId, [address]);
      toast.success("Trader removed from wallet");
      setDailyRefreshKey((k) => k + 1);
      await refresh(period);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove trader");
    } finally {
      setPendingAddress(null);
    }
  }

  const periodLabel = period === "day" ? "Today" : period === "week" ? "This week" : "This month";

  return (
    <div className="flex flex-col overflow-hidden rounded-[20px] border border-border bg-card max-md:overflow-visible max-md:border-0 max-md:bg-transparent">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 max-md:border-0 max-md:p-0 max-md:pb-3 md:px-5">
        <b className="text-[15px] font-semibold">Traders performance</b>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <Segmented options={VIEWS} value={view} onChange={setView} label="View" block={phone} tall={phone} className="max-md:basis-full" />
          {view === "overview" && <Segmented options={PERIODS} value={period} onChange={setPeriod} label="Period" block={phone} tall={phone} className="max-md:basis-full" />}
          <AddTradersToWalletDialog
            walletId={walletId}
            existingAddresses={traders.map((t) => t.traderAddress)}
            onAdded={() => {
              setDailyRefreshKey((k) => k + 1);
              refresh(period);
              onChanged?.();
            }}
          />
        </div>
      </div>

      {view === "daily" ? (
        <div className="md:p-0">
          <WalletTradersDailyTable walletId={walletId} refreshKey={dailyRefreshKey} />
        </div>
      ) : loading && traders.length === 0 ? (
        <div className="flex flex-col gap-2.5 md:p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : traders.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-10 text-center md:m-5">
          <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
            <Users className="size-6" />
          </span>
          <b className="text-sm font-semibold">No traders assigned yet — add some to start mirroring their trades on this wallet.</b>
        </div>
      ) : (
        <>
          {/* Phone: one card per trader. */}
          <div className="flex flex-col gap-3 md:hidden">
            {traders.map((t) => {
              const periodHasTrades = t.periodTradeCount > 0;
              return (
                <article key={t.traderAddress} className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <TraderAvatar address={t.traderAddress} size="lg" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <b className={cn("truncate text-[15px] font-semibold", !t.label && "font-normal text-text-3")}>{t.label || "Unlabeled"}</b>
                      <AddressChip address={t.traderAddress} />
                    </div>
                    <div className="flex flex-col items-end">
                      <b className={cn("text-[17px] font-semibold tabular-nums", tone(t.lifetimeRealizedPnlUsd))}>{signedUsd(t.lifetimeRealizedPnlUsd)}</b>
                      <span className="text-xs text-text-3">lifetime</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-x-3 border-y border-border py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[11.5px] text-text-3">Added</span>
                      <span className="truncate text-sm font-semibold">{formatRelativeTime(t.addedAt)}</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[11.5px] text-text-3">Trades</span>
                      <span className="text-sm font-semibold tabular-nums">{t.lifetimeTrades}</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[11.5px] text-text-3">{periodLabel}</span>
                      <span className={cn("text-sm font-semibold tabular-nums", periodHasTrades ? tone(t.periodPnlUsd) : "text-text-3")}>{periodHasTrades ? signedUsd(t.periodPnlUsd) : "—"}</span>
                    </div>
                  </div>
                  <Button variant="outline" className="h-11 gap-2 text-text-2" disabled={pendingAddress === t.traderAddress} onClick={() => setConfirmAddress(t.traderAddress)}>
                    {pendingAddress === t.traderAddress ? <Loader2 className="animate-spin" /> : <UserMinus />}
                    Remove from wallet
                  </Button>
                </article>
              );
            })}
          </div>

          {/* Desktop: the table. */}
          <div className="max-md:hidden">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className={cn(headCls, "pl-5")}>Trader</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Added</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Lifetime trades</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>Lifetime P&amp;L</TableHead>
                  <TableHead className={cn(headCls, "text-right")}>{periodLabel} P&amp;L</TableHead>
                  <TableHead className={cn(headCls, "w-[110px] pr-5 text-right")}>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traders.map((t) => {
                  const periodHasTrades = t.periodTradeCount > 0;
                  return (
                    <TableRow key={t.traderAddress} className="h-[60px] border-border">
                      <TableCell className="max-w-3xs pl-5 sm:max-w-xs">
                        <div className="flex min-w-0 items-center gap-3">
                          <TraderAvatar address={t.traderAddress} size="sm" />
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className={cn("truncate text-[13px] font-semibold", !t.label && "font-normal text-text-3")}>{t.label || "Unlabeled"}</span>
                            <AddressChip address={t.traderAddress} />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-[13px] text-text-3">{formatRelativeTime(t.addedAt)}</TableCell>
                      <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{t.lifetimeTrades}</TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <b className={cn("font-semibold", tone(t.lifetimeRealizedPnlUsd))}>{signedUsd(t.lifetimeRealizedPnlUsd)}</b>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        {periodHasTrades ? (
                          <span className="inline-flex flex-col items-end leading-[1.3]">
                            <span className={tone(t.periodPnlUsd)}>{signedUsd(t.periodPnlUsd)}</span>
                            <span className="text-[11px] text-text-3">
                              {t.periodTradeCount} trade{t.periodTradeCount === 1 ? "" : "s"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Button variant="ghost" size="sm" disabled={pendingAddress === t.traderAddress} onClick={() => setConfirmAddress(t.traderAddress)} className="text-text-2 hover:text-negative">
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <AlertDialog open={!!confirmAddress} onOpenChange={(open) => !open && setConfirmAddress(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this trader from the wallet?</AlertDialogTitle>
            <AlertDialogDescription>No new trades are mirrored for them. Positions already held stay open and are still tracked normally.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
              onClick={() => {
                if (confirmAddress) void handleRemove(confirmAddress);
                setConfirmAddress(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
