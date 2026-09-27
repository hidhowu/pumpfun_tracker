"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  ArrowUpRight,
  ShieldBan,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Layers,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import type { Trader } from "@/lib/types";
import { formatAddress, formatRelativeTime, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type TraderTableProps = {
  traders: Trader[];
  mode: "active" | "blacklisted";
  loading?: boolean;
  onBlacklistToggle: (address: string, blacklist: boolean) => Promise<void> | void;
  onMuteToggle: (address: string, muted: boolean | null) => Promise<void> | void;
  emptyMessage?: string;
};

function PnlValue({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">-</span>;
  const positive = value > 0;
  const negative = value < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        positive && "text-positive",
        negative && "text-negative"
      )}
    >
      {positive ? (
        <TrendingUp className="size-3.5" />
      ) : negative ? (
        <TrendingDown className="size-3.5" />
      ) : (
        <Minus className="size-3.5 text-muted-foreground" />
      )}
      {formatUsd(value)}
    </span>
  );
}

export function TraderTable({
  traders,
  mode,
  loading,
  onBlacklistToggle,
  onMuteToggle,
  emptyMessage,
}: TraderTableProps) {
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);

  async function handleBlacklistToggle(address: string, blacklist: boolean) {
    setPendingAddress(address);
    try {
      await onBlacklistToggle(address, blacklist);
    } finally {
      setPendingAddress(null);
    }
  }

  async function handleMuteToggle(address: string, checked: boolean) {
    setPendingAddress(address);
    try {
      // Flipping the switch always sets an explicit override (not back to
      // "inherit default") - clearing an override is a separate action we
      // don't expose in the table (kept in scope: this is the toggle asked for).
      await onMuteToggle(address, !checked);
    } finally {
      setPendingAddress(null);
    }
  }

  function copyAddress(address: string) {
    navigator.clipboard
      .writeText(address)
      .then(() => toast.success("Address copied"))
      .catch(() => toast.error("Could not copy address"));
  }

  if (!loading && traders.length === 0) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? "No traders here yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="border-border/60 hover:bg-transparent">
            <TableHead className="pl-4">Trader</TableHead>
            <TableHead className="text-right">Active Trades</TableHead>
            <TableHead className="text-right">Daily PnL (Actualized)</TableHead>
            <TableHead className="text-right">Daily Win Rate</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Daily Combined PnL</TableHead>
            <TableHead className="text-right">Last Active</TableHead>
            <TableHead className="text-center">Notify</TableHead>
            <TableHead className="pr-4 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading &&
            traders.length === 0 &&
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`} className="border-border/60">
                <TableCell colSpan={10} className="h-14">
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                </TableCell>
              </TableRow>
            ))}

          {traders.map((trader) => {
            const isPending = pendingAddress === trader.address;
            const today = trader.today;
            const hasClosedToday = today.closedTradeCount > 0;
            const combinedPositive = hasClosedToday && today.combinedPercent > 0;
            const combinedNegative = hasClosedToday && today.combinedPercent < 0;

            return (
              <TableRow key={trader._id} className="border-border/60">
                <TableCell className="pl-4">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/traders/${trader.address}`}
                        className="group flex items-center gap-1 font-mono text-sm text-foreground hover:text-primary"
                      >
                        {formatAddress(trader.address, 5)}
                        <ArrowUpRight className="size-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
                      </Link>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => copyAddress(trader.address)}
                            className="text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Copy className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Copy address</TooltipContent>
                      </Tooltip>
                    </div>
                    {trader.label ? (
                      <span className="text-xs text-muted-foreground">{trader.label}</span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono text-sm">
                  <span className="inline-flex items-center justify-end gap-1">
                    <Layers className="size-3.5 text-muted-foreground" />
                    {trader.sim.openPositionCount}
                  </span>
                </TableCell>

                <TableCell className="text-right font-mono text-sm">
                  <PnlValue value={today.actualizedUsd} />
                </TableCell>

                <TableCell className="text-right font-mono text-sm">
                  {!hasClosedToday ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1">
                          <Target className="size-3.5 text-muted-foreground" />
                          {today.winRatePercent === null ? "-" : `${today.winRatePercent.toFixed(0)}%`}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {today.wins}W / {today.losses}L today
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>

                <TableCell className="text-right font-mono text-sm">{formatUsd(trader.sim.balanceUsd)}</TableCell>

                <TableCell className="text-right font-mono text-sm">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>{formatUsd(trader.walletValueUsd)}</span>
                    </TooltipTrigger>
                    <TooltipContent>Balance + current value of open positions</TooltipContent>
                  </Tooltip>
                </TableCell>

                <TableCell className="text-right font-mono text-sm">
                  {!hasClosedToday ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        combinedPositive && "text-positive",
                        combinedNegative && "text-negative"
                      )}
                    >
                      {combinedPositive ? (
                        <TrendingUp className="size-3.5" />
                      ) : combinedNegative ? (
                        <TrendingDown className="size-3.5" />
                      ) : (
                        <Minus className="size-3.5 text-muted-foreground" />
                      )}
                      {today.combinedPercent >= 0 ? "+" : ""}
                      {today.combinedPercent.toFixed(1)}%
                    </span>
                  )}
                </TableCell>

                <TableCell className="text-right text-sm text-muted-foreground">
                  {formatRelativeTime(trader.sim.lastActionAt)}
                </TableCell>

                <TableCell>
                  <div className="flex items-center justify-center gap-1.5">
                    <Switch
                      checked={!trader.muted}
                      disabled={isPending}
                      onCheckedChange={(checked) => handleMuteToggle(trader.address, checked)}
                      aria-label="Toggle notifications"
                    />
                    {trader.mutedOverride === null ? (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        default
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="pr-4 text-right">
                  {mode === "active" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          className="text-muted-foreground hover:text-negative"
                        >
                          <ShieldBan className="size-4" />
                          Blacklist
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Blacklist this trader?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {formatAddress(trader.address, 6)} will stop being tracked -
                            no new trades will be recorded while blacklisted. All of
                            their existing history stays visible under Blacklisted,
                            and you can unblacklist them anytime to resume tracking.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-negative text-negative-foreground hover:bg-negative/90"
                            onClick={() => handleBlacklistToggle(trader.address, true)}
                          >
                            Blacklist
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      className="text-muted-foreground hover:text-positive"
                      onClick={() => handleBlacklistToggle(trader.address, false)}
                    >
                      <ShieldCheck className="size-4" />
                      Unblacklist
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
