"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, PauseCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/format";
import type { BacktestRunTraderView, BacktestStage, BacktestStatus, BacktestStrategy } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";

export const pnlTone = (n: number | null | undefined) => (n == null || n === 0 ? undefined : n > 0 ? "text-positive" : "text-negative");

export function formatSignedPercent(n: number | null | undefined, digits = 1): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const part = (n: number, unit: string) => (n > 0 ? ` ${n}${unit}` : "");
  if (minutes < 60) return `${minutes}m${part(totalSeconds % 60, "s")}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h${part(minutes % 60, "m")}`;
  return `${Math.floor(hours / 24)}d${part(hours % 24, "h")}`;
}

export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return "—";
  return new Date(input).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(input: string | Date | number | null | undefined): string {
  if (input == null) return "—";
  return new Date(input).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

const STATUS_META: Record<BacktestStatus, { label: string; className: string; icon: typeof Loader2; spin?: boolean }> = {
  queued: { label: "Queued", className: "border-border/60 text-muted-foreground", icon: CircleDashed },
  running: { label: "Running", className: "border-primary/30 bg-primary/10 text-primary", icon: Loader2, spin: true },
  paused: { label: "Paused", className: "border-border/60 text-muted-foreground", icon: PauseCircle },
  completed: { label: "Completed", className: "border-positive/30 bg-positive/10 text-positive", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", className: "border-border/60 text-muted-foreground", icon: XCircle },
  failed: { label: "Failed", className: "border-negative/30 bg-negative/10 text-negative", icon: AlertTriangle },
};

/**
 * Backtests are worked one at a time. `queuePosition` (from the run's progress): 0 = being worked on / next to be picked up,
 * 1 = next in line, 2 = the one after... A queued backtest that is waiting shows its place.
 */
export function waitingInQueue(status: BacktestStatus, queuePosition: number | null | undefined): queuePosition is number {
  return status === "queued" && typeof queuePosition === "number" && queuePosition > 0;
}

export function RunStatusBadge({ status, control, queuePosition }: { status: BacktestStatus; control?: "run" | "pause" | "cancel"; queuePosition?: number | null }) {
  // A pause/cancel request is acknowledged by the worker within a couple of seconds - show it as "pausing" meanwhile.
  const pending = (status === "running" || status === "queued") && control && control !== "run";
  const meta = pending
    ? { ...STATUS_META.paused, label: control === "pause" ? "Pausing…" : "Cancelling…" }
    : waitingInQueue(status, queuePosition)
      ? { ...STATUS_META.queued, label: `Queued · #${queuePosition}` }
      : STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", meta.className)}>
      <Icon className={cn("size-3", "spin" in meta && meta.spin && !pending && "animate-spin")} />
      {meta.label}
    </Badge>
  );
}

export function ProgressBar({
  percent,
  tone = "primary",
  className,
}: {
  percent: number;
  tone?: "primary" | "positive" | "negative" | "muted";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "primary" && "bg-primary",
          tone === "positive" && "bg-positive",
          tone === "negative" && "bg-negative",
          tone === "muted" && "bg-muted-foreground/50"
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

const STAGE_LABEL: Record<BacktestStage, string> = {
  pending: "Waiting",
  collecting: "Collecting trades",
  simulating: "Simulating trades",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

/** One line saying where an address is, with the numbers that matter for that stage. */
export function stageDescription(t: BacktestRunTraderView): string {
  if (t.stage === "collecting") {
    if (t.collect.listing) return t.collect.source === "api" ? `Fetching trades… ${t.collect.signaturesFound.toLocaleString()} found` : `Listing signatures… ${t.collect.signaturesFound.toLocaleString()} found`;
    if (t.collect.signaturesToProcess === 0) return "Collecting transactions";
    return `Transactions ${t.collect.signaturesProcessed.toLocaleString()} / ${t.collect.signaturesToProcess.toLocaleString()}`;
  }
  if (t.stage === "simulating") return `Tokens ${t.sim.signalsDone.toLocaleString()} / ${t.sim.signalsTotal.toLocaleString()}`;
  if (t.stage === "failed") return t.error ? `Failed: ${t.error}` : "Failed";
  if (t.stage === "skipped") return t.error ?? "Skipped";
  return STAGE_LABEL[t.stage];
}

export function StageBadge({ stage }: { stage: BacktestStage }) {
  const className =
    stage === "done"
      ? "border-positive/30 text-positive"
      : stage === "failed"
        ? "border-negative/30 text-negative"
        : stage === "skipped"
          ? "border-amber-500/30 text-amber-500"
          : stage === "pending"
          ? "border-border/60 text-muted-foreground"
          : "border-primary/30 text-primary";
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", className)}>
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

/** The strategy a backtest follows, as short readable chips. */
export function StrategyChips({ settings }: { settings: BacktestStrategy }) {
  const chips: string[] = [
    `Trade size ${formatUsd(settings.tradeSizeUsd)}`,
    `Dust buy < ${formatUsd(settings.dustBuyUsd)}`,
    `Dust sell < ${settings.dustSellFractionPercent}%`,
    settings.stopLossPercent != null ? `Stop-loss −${Math.abs(settings.stopLossPercent)}%` : "No stop-loss",
    settings.takeProfitPercent != null ? `Take-profit +${Math.abs(settings.takeProfitPercent)}%` : "No take-profit",
    settings.maxTradeTimeSeconds > 0 ? `Max hold ${formatDuration(settings.maxTradeTimeSeconds * 1000)}` : "No max hold",
    ...settings.trailingStops.map((r) => `Trail arm +${r.armPercent}% → exit ${r.exitPercent}%`),
    `Delay ${settings.executionDelaySeconds}s`,
    settings.riskCheckIntervalSeconds ? `Checks every ${settings.riskCheckIntervalSeconds}s` : "Checks every trade",
    ...(settings.fillLatencySeconds ? [`+${settings.fillLatencySeconds}s reaction`] : []),
    `Fees ${settings.pumpFeePercent}% + ${formatUsd(settings.jitoFeeUsd)}`,
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <Badge key={chip} variant="outline" className="border-border/60 font-normal text-muted-foreground">
          {chip}
        </Badge>
      ))}
    </div>
  );
}

export const CLOSE_REASON_LABEL: Record<string, string> = {
  trader_sell: "Trader sold",
  stop_loss: "Stop-loss",
  take_profit: "Take-profit",
  trailing_stop: "Trailing stop",
  max_hold_time: "Max hold time",
};

export const SKIP_REASON_LABEL: Record<string, string> = {
  dust: "Dust buy",
  no_data: "No price data",
  insufficient_balance: "Insufficient balance",
  unresolved: "Too many trades to resolve",
  error: "Error",
};
