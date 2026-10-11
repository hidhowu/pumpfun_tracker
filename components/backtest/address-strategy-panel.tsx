"use client";

import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsd } from "@/lib/format";
import type { BacktestAddressDetail } from "@/lib/backtest-types";
import { SKIP_REASON_LABEL, formatDate, formatDuration } from "./shared";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}

const SKIP_KEYS: Array<[keyof BacktestAddressDetail["trader"]["sim"]["skipped"], string]> = [
  ["dust", SKIP_REASON_LABEL.dust],
  ["noData", SKIP_REASON_LABEL.no_data],
  ["insufficientBalance", SKIP_REASON_LABEL.insufficient_balance],
  ["unresolved", SKIP_REASON_LABEL.unresolved],
  ["error", SKIP_REASON_LABEL.error],
];

/** The profile settings this backtest followed (read-only - they were frozen when it started), and how the address's data was gathered. */
export function AddressStrategyPanel({ detail }: { detail: BacktestAddressDetail }) {
  const { run, trader } = detail;
  const s = run.settings;
  const skipped = SKIP_KEYS.filter(([k]) => trader.sim.skipped[k] > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-primary" /> Strategy followed
          </CardTitle>
          <CardDescription>Copied from &quot;{run.profileName}&quot; when the backtest started. Changing the profile later doesn&apos;t affect this result.</CardDescription>
        </CardHeader>
        <CardContent>
          <Row label="Starting allocation" value={formatUsd(s.allocationUsd)} />
          <Row label="Trade size" value={formatUsd(s.tradeSizeUsd)} />
          <Row label="Dust buy below" value={formatUsd(s.dustBuyUsd)} />
          <Row label="Dust sell below" value={`${s.dustSellFractionPercent}%`} />
          <Row label="Stop-loss" value={s.stopLossPercent != null ? `−${Math.abs(s.stopLossPercent)}%` : "off"} />
          <Row label="Take-profit" value={s.takeProfitPercent != null ? `+${Math.abs(s.takeProfitPercent)}%` : "off"} />
          <Row label="Max hold time" value={s.maxTradeTimeSeconds > 0 ? formatDuration(s.maxTradeTimeSeconds * 1000) : "off"} />
          <Row
            label="Trailing stops"
            value={
              s.trailingStops.length === 0 ? (
                "off"
              ) : (
                <span className="flex flex-col items-end gap-0.5">
                  {s.trailingStops.map((r) => (
                    <span key={r._id}>
                      arm +{r.armPercent}% → exit {r.exitPercent}%
                    </span>
                  ))}
                </span>
              )
            }
          />
          <Row label="Negative balance" value={s.allowNegativeBalance ? "allowed" : "not allowed"} />
          <Row label="Execution delay" value={`${s.executionDelaySeconds}s`} />
          <Row label="Fees" value={`${s.pumpFeePercent}% + ${formatUsd(s.jitoFeeUsd)} per trade`} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Backtest data</CardTitle>
          <CardDescription>
            {run.days}-day window, {formatDate(run.windowStart)} – {formatDate(run.windowEnd)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Row label="Transactions found" value={trader.collect.signaturesFound.toLocaleString()} />
          <Row label="Transactions read" value={`${trader.collect.signaturesProcessed.toLocaleString()} / ${trader.collect.signaturesToProcess.toLocaleString()}`} />
          {trader.collect.signaturesFailed > 0 && <Row label="Couldn't be fetched" value={<span className="text-amber-500">{trader.collect.signaturesFailed.toLocaleString()}</span>} />}
          <Row label="pump.fun trades found" value={trader.collect.tradesFound.toLocaleString()} />
          <Row label="Tokens simulated" value={`${trader.sim.signalsDone.toLocaleString()} / ${trader.sim.signalsTotal.toLocaleString()}`} />
          {skipped.length > 0 && (
            <div className="flex flex-col gap-2 pt-3">
              <span className="text-xs text-muted-foreground">Signals not traded</span>
              <div className="flex flex-wrap gap-1.5">
                {skipped.map(([k, label]) => (
                  <Badge key={k} variant="outline" className="border-border/60 font-normal">
                    {label} · {trader.sim.skipped[k]}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {detail.trader.stats.open > 0 && <p className="pt-3 text-xs text-muted-foreground">{detail.trader.stats.open} trade(s) were still open when the window ended and are marked at the last price.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
