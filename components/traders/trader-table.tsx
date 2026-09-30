"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  History,
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
import { formatAddress, formatRelativeTime, formatSol, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

type TraderTableProps = {
  traders: Trader[];
  mode: "active" | "blacklisted";
  loading?: boolean;
  onBlacklistToggle: (address: string, blacklist: boolean) => Promise<void> | void;
  onMuteToggle: (address: string, muted: boolean | null) => Promise<void> | void;
  emptyMessage?: string;
};

type SortKey =
  | "address"
  | "activeTrades"
  | "dailyPnl"
  | "winRate"
  | "balance"
  | "value"
  | "combinedPnl"
  | "lastActive"
  | "lifetimeTrades"
  | "lifetimePnl";
type SortDir = "asc" | "desc";

const SORT_ACCESSORS: Record<SortKey, (t: Trader) => number | string> = {
  address: (t) => t.address.toLowerCase(),
  activeTrades: (t) => t.sim.openPositionCount,
  dailyPnl: (t) => t.today.actualizedUsd ?? -Infinity,
  winRate: (t) => t.today.winRatePercent ?? -Infinity,
  balance: (t) => t.sim.balanceUsd,
  value: (t) => t.walletValueUsd,
  combinedPnl: (t) => (t.today.closedTradeCount > 0 ? t.today.combinedPercent : -Infinity),
  lastActive: (t) => (t.sim.lastActionAt ? new Date(t.sim.lastActionAt).getTime() : -Infinity),
  // The tracked wallet's own lifetime on-chain stats - not our simulation.
  lifetimeTrades: (t) => t.stats.tradeCount,
  lifetimePnl: (t) => t.stats.realizedPnlSol,
};

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = activeKey === sortKey;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
        <Icon className={cn("size-3", !isActive && "opacity-40")} />
      </button>
    </TableHead>
  );
}

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
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Address reads naturally A-Z first; every numeric column reads
      // naturally highest-first (biggest profit/value on top).
      setSortDir(key === "address" ? "asc" : "desc");
    }
  }

  const sortedTraders = useMemo(() => {
    if (!sortKey) return traders;
    const accessor = SORT_ACCESSORS[sortKey];
    const sorted = [...traders].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }, [traders, sortKey, sortDir]);

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
            <TableHead className="pl-4">
              <button
                type="button"
                onClick={() => handleSort("address")}
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors hover:text-foreground",
                  sortKey === "address" ? "text-foreground" : "text-muted-foreground"
                )}
              >
                Trader
                {sortKey === "address" ? (
                  sortDir === "asc" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  )
                ) : (
                  <ArrowUpDown className="size-3 opacity-40" />
                )}
              </button>
            </TableHead>
            <SortableHead label="Lifetime Trades" sortKey="lifetimeTrades" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Lifetime PnL" sortKey="lifetimePnl" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Active Trades" sortKey="activeTrades" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Daily PnL (Actualized)" sortKey="dailyPnl" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Daily Win Rate" sortKey="winRate" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Balance" sortKey="balance" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Value" sortKey="value" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Daily Combined PnL" sortKey="combinedPnl" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortableHead label="Last Active" sortKey="lastActive" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <TableHead className="text-center">Notify</TableHead>
            <TableHead className="pr-4 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading &&
            traders.length === 0 &&
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`} className="border-border/60">
                <TableCell colSpan={12} className="h-14">
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                </TableCell>
              </TableRow>
            ))}

          {sortedTraders.map((trader) => {
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
                        target="_blank"
                        rel="noopener noreferrer"
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
                  <span className="inline-flex items-center justify-end gap-1 text-muted-foreground">
                    <History className="size-3.5" />
                    {trader.stats.tradeCount}
                  </span>
                </TableCell>

                <TableCell className="text-right font-mono text-sm">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      trader.stats.realizedPnlSol > 0 && "text-positive",
                      trader.stats.realizedPnlSol < 0 && "text-negative"
                    )}
                  >
                    {trader.stats.realizedPnlSol > 0 ? (
                      <TrendingUp className="size-3.5" />
                    ) : trader.stats.realizedPnlSol < 0 ? (
                      <TrendingDown className="size-3.5" />
                    ) : (
                      <Minus className="size-3.5 text-muted-foreground" />
                    )}
                    {formatSol(trader.stats.realizedPnlSol)}
                  </span>
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
