"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AddTradersToWalletDialog } from "./add-traders-to-wallet-dialog";
import { WalletTradersDailyTable } from "./wallet-traders-daily-table";
import { getWalletTraders, removeTradersFromWallet } from "@/lib/api";
import { formatAddress, formatRelativeTime, formatUsd } from "@/lib/format";
import type { WalletTraderPerformance } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = { walletId: string };
type Period = "day" | "week" | "month";
type View = "overview" | "daily";

/**
 * Assigned traders and how they've performed ON THIS WALLET specifically -
 * every figure here (lifetime AND period) is scoped to trades made only
 * while a trader has been on this wallet, never their overall/lifetime
 * stats. A trader with a 1000% lifetime return elsewhere starts at zero here.
 */
export function WalletTradersTab({ walletId }: Props) {
  const [period, setPeriod] = useState<Period>("day");
  const [view, setView] = useState<View>("overview");
  const [dailyRefreshKey, setDailyRefreshKey] = useState(0);
  const [traders, setTraders] = useState<WalletTraderPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove trader");
    } finally {
      setPendingAddress(null);
    }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4 text-primary" /> Traders performance
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="daily">Last 7 days</TabsTrigger>
            </TabsList>
          </Tabs>
          {view === "overview" && (
            <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <AddTradersToWalletDialog
            walletId={walletId}
            existingAddresses={traders.map((t) => t.traderAddress)}
            onAdded={() => {
              setDailyRefreshKey((k) => k + 1);
              refresh(period);
            }}
          />
        </div>
      </CardHeader>
      <CardContent>
        {view === "daily" ? (
          <WalletTradersDailyTable walletId={walletId} refreshKey={dailyRefreshKey} />
        ) : loading && traders.length === 0 ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : traders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            No traders assigned yet - add some to start mirroring their trades on this wallet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trader</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                  <TableHead className="text-right">Lifetime trades</TableHead>
                  <TableHead className="text-right">Lifetime P&amp;L</TableHead>
                  <TableHead className="text-right">{period === "day" ? "Today" : period === "week" ? "This week" : "This month"} P&amp;L</TableHead>
                  <TableHead className="pr-4 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traders.map((t) => {
                  const lifetimePositive = t.lifetimeRealizedPnlUsd > 0;
                  const lifetimeNegative = t.lifetimeRealizedPnlUsd < 0;
                  const periodHasTrades = t.periodTradeCount > 0;
                  const periodPositive = periodHasTrades && t.periodPnlUsd > 0;
                  const periodNegative = periodHasTrades && t.periodPnlUsd < 0;
                  return (
                    <TableRow key={t.traderAddress}>
                      <TableCell className="max-w-3xs sm:max-w-xs">
                        <a
                          href={`/traders/${t.traderAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-w-0 items-center gap-1 font-mono text-xs hover:text-primary"
                        >
                          <span className="truncate">{t.label || formatAddress(t.traderAddress, 6)}</span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{formatRelativeTime(t.addedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">{t.lifetimeTrades}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", lifetimePositive && "text-positive", lifetimeNegative && "text-negative")}>
                        {formatUsd(t.lifetimeRealizedPnlUsd)}
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", periodPositive && "text-positive", periodNegative && "text-negative")}>
                        {periodHasTrades ? (
                          <span className="inline-flex flex-col items-end">
                            <span>{formatUsd(t.periodPnlUsd)}</span>
                            <span className="text-[11px] opacity-80">{t.periodTradeCount} trade{t.periodTradeCount === 1 ? "" : "s"}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pendingAddress === t.traderAddress}
                              className="text-muted-foreground hover:text-negative"
                            >
                              Remove
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this trader from the wallet?</AlertDialogTitle>
                              <AlertDialogDescription>
                                No new trades will be mirrored for them going forward. Any position this wallet
                                already holds because of them stays open and is still tracked normally.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-negative text-negative-foreground hover:bg-negative/90"
                                onClick={() => handleRemove(t.traderAddress)}
                              >
                                Remove
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
