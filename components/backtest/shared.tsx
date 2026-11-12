"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, PauseCircle, XCircle } from "lucide-react";
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

const PILL = "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap";
const PILL_NEUTRAL = "border-line-2 bg-surface-3 text-text-2";
const PILL_VOLT = "border-volt-line bg-volt-soft text-primary";
const PILL_POS = "border-positive/30 bg-pos-soft text-positive";
const PILL_NEG = "border-destructive/30 bg-neg-soft text-destructive";
const PILL_WARN = "border-warn/30 bg-warn-soft text-warn";

const STATUS_META: Record<BacktestStatus, { label: string; className: string; icon: typeof Loader2; spin?: boolean }> = {
  queued: { label: "Queued", className: PILL_NEUTRAL, icon: CircleDashed },
  running: { label: "Running", className: PILL_VOLT, icon: Loader2, spin: true },
  paused: { label: "Paused", className: PILL_NEUTRAL, icon: PauseCircle },
  completed: { label: "Completed", className: PILL_POS, icon: CheckCircle2 },
  cancelled: { label: "Cancelled", className: PILL_NEUTRAL, icon: XCircle },
  failed: { label: "Failed", className: PILL_NEG, icon: AlertTriangle },
};

/** A small rounded label in one of the design's tones ("Combined", "Done", "default"...). */
export function Pill({ tone = "neutral", className, children }: { tone?: "neutral" | "volt" | "pos" | "neg" | "warn"; className?: string; children: React.ReactNode }) {
  const toneClass = tone === "volt" ? PILL_VOLT : tone === "pos" ? PILL_POS : tone === "neg" ? PILL_NEG : tone === "warn" ? PILL_WARN : PILL_NEUTRAL;
  return <span className={cn(PILL, toneClass, className)}>{children}</span>;
}

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
    <span className={cn(PILL, meta.className)}>
      <Icon className={cn("size-3", "spin" in meta && meta.spin && !pending && "animate-spin")} />
      {meta.label}
    </span>
  );
}

export function ProgressBar({
  percent,
  tone = "primary",
  className,
}: {
  percent: number;
  tone?: "primary" | "positive" | "negative" | "warn" | "muted";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-4", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "primary" && "bg-primary",
          tone === "positive" && "bg-positive",
          tone === "negative" && "bg-negative",
          tone === "warn" && "bg-warn",
          tone === "muted" && "bg-text-3"
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
  const className = stage === "done" ? PILL_POS : stage === "failed" ? PILL_NEG : stage === "skipped" ? PILL_WARN : stage === "pending" ? PILL_NEUTRAL : PILL_VOLT;
  return <span className={cn(PILL, className)}>{STAGE_LABEL[stage]}</span>;
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
        <span key={chip} className="inline-flex h-[22px] items-center rounded-full border border-line-2 bg-surface-3 px-2 text-[11.5px] whitespace-nowrap text-text-2">
          {chip}
        </span>
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
