import { Siren } from "lucide-react";
import { formatUsd } from "@/lib/format";
import type { WalletPanic } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Green when the wallet is far from its panic level, through yellow, to red as it reaches it. */
export function panicColor(fraction: number): string {
  const f = Math.min(1, Math.max(0, fraction));
  return `hsl(${Math.round(130 * (1 - f))} 78% 45%)`;
}

/**
 * The "should I panic?" bar: fills with how far below its highest point the wallet's realised P&L is right now, against the panic level set
 * in the wallet's settings. Full and red = the wallet is doing worse than its backtest led us to expect.
 */
export function PanicBar({ panic, compact = false }: { panic: WalletPanic; compact?: boolean }) {
  const filled = Math.min(1, Math.max(0, panic.fraction));
  const color = panicColor(panic.fraction);
  return (
    <div className={cn("flex w-full min-w-0 flex-col", compact ? "gap-1" : "gap-1.5")}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn("flex items-center gap-1 font-semibold", panic.panic ? "text-negative" : "text-muted-foreground")}>
          {panic.panic && <Siren className="size-3.5" />}
          {panic.panic ? "PANIC" : "Panic level"}
        </span>
        <span className="tabular-nums text-muted-foreground">
          <span style={{ color }} className="font-semibold">
            {formatUsd(-panic.currentLossUsd)}
          </span>{" "}
          of {formatUsd(-panic.limitUsd)}
        </span>
      </div>
      <div
        className={cn("w-full overflow-hidden rounded-full bg-muted", compact ? "h-1.5" : "h-2.5")}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(filled * 100)}
        aria-label="Loss against the panic level"
      >
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(filled * 100, panic.currentLossUsd > 0 ? 2 : 0)}%`, backgroundColor: color }} />
      </div>
      {!compact && (
        <p className="text-xs text-muted-foreground">
          {panic.panic
            ? "The wallet's loss stretch has reached the panic level: it is doing worse than it was expected to."
            : panic.currentLossUsd === 0
              ? "At its highest point so far."
              : `${Math.round(filled * 100)}% of the way to the panic level.`}
          {panic.deepestLossUsd > 0 && (
            <>
              {" "}
              Worst stretch so far {formatUsd(-panic.deepestLossUsd)}
              {panic.everPanicked && !panic.panic ? " (it did reach the panic level before and has recovered)" : ""}.
            </>
          )}
        </p>
      )}
    </div>
  );
}
