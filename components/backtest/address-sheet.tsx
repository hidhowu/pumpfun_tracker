"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/format";
import type { BacktestRunTraderView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { EquityChart } from "./equity-chart";
import { PositionsTable } from "./positions-table";
import { ProgressBar, StageBadge, SKIP_REASON_LABEL, formatSignedPercent, formatDateTime, pnlTone, stageDescription } from "./shared";

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

const SKIP_KEYS: Array<[keyof BacktestRunTraderView["sim"]["skipped"], string]> = [
  ["dust", SKIP_REASON_LABEL.dust],
  ["noData", SKIP_REASON_LABEL.no_data],
  ["insufficientBalance", SKIP_REASON_LABEL.insufficient_balance],
  ["unresolved", SKIP_REASON_LABEL.unresolved],
  ["error", SKIP_REASON_LABEL.error],
];

/** One address of a run: where it is, what it has earned so far, and every trade simulated for it. */
export function AddressSheet({
  runId,
  trader,
  onClose,
  refreshKey,
}: {
  runId: string;
  trader: BacktestRunTraderView | null;
  onClose: () => void;
  refreshKey: number;
}) {
  const s = trader?.stats;
  const settled = trader?.stage === "done" || trader?.stage === "failed";

  return (
    <Sheet open={!!trader} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:sm:max-w-3xl">
        {trader && s && (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-all">{trader.label || "Address"}</span>
                <StageBadge stage={trader.stage} />
              </SheetTitle>
              <SheetDescription className="break-all font-mono text-xs">{trader.address}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-col gap-1.5">
                <ProgressBar percent={trader.progressPercent} tone={trader.stage === "failed" ? "negative" : trader.stage === "done" ? "positive" : "primary"} />
                <span className="text-xs text-muted-foreground">
                  {trader.progressPercent.toFixed(0)}% · {stageDescription(trader)}
                  {trader.collect.tradesFound > 0 && ` · ${trader.collect.tradesFound.toLocaleString()} pump.fun trades found`}
                </span>
                {!settled && trader.sim.simulatedThrough && (
                  <span className="text-xs text-muted-foreground">Simulated through {formatDateTime(trader.sim.simulatedThrough)} UTC - results so far cover that period.</span>
                )}
                {trader.error && <span className="text-xs text-negative">{trader.error}</span>}
              </div>

              <div className="grid grid-cols-2 gap-4 rounded-lg border border-border/60 bg-card/50 p-4 sm:grid-cols-4">
                <Stat label="Realized P&L" value={s.closed > 0 ? formatUsd(s.realizedPnlUsd) : "—"} className={pnlTone(s.realizedPnlUsd)} />
                <Stat label="Combined" value={s.closed > 0 ? formatSignedPercent(s.combinedPercent, 0) : "—"} className={pnlTone(s.combinedPercent)} />
                <Stat label="Win rate" value={s.winRatePercent != null ? `${s.winRatePercent.toFixed(0)}% (${s.wins}W/${s.losses}L)` : "—"} />
                <Stat label="Avg per trade" value={formatSignedPercent(s.avgPercent)} className={pnlTone(s.avgPercent)} />
                <Stat label="Closed trades" value={s.closed} />
                <Stat label="Open at end" value={s.open > 0 ? `${s.open} (${formatUsd(s.unrealizedUsd)})` : "0"} />
                <Stat label="Best trade" value={formatSignedPercent(s.bestPercent, 0)} className={pnlTone(s.bestPercent)} />
                <Stat label="Worst trade" value={formatSignedPercent(s.worstPercent, 0)} className={pnlTone(s.worstPercent)} />
              </div>

              {SKIP_KEYS.some(([k]) => trader.sim.skipped[k] > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Signals not traded:</span>
                  {SKIP_KEYS.filter(([k]) => trader.sim.skipped[k] > 0).map(([k, label]) => (
                    <Badge key={k} variant="outline" className="border-border/60 font-normal">
                      {label} · {trader.sim.skipped[k]}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Cumulative P&amp;L</h3>
                <EquityChart key={trader.address} runId={runId} address={trader.address} refreshKey={refreshKey} />
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Trades</h3>
                <PositionsTable key={trader.address} runId={runId} address={trader.address} refreshKey={refreshKey} />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
