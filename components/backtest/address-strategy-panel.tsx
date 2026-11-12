"use client";

import { HelpTip } from "@/components/ui/help-tip";
import { formatUsd } from "@/lib/format";
import type { BacktestAddressDetail } from "@/lib/backtest-types";
import { Note, Panel } from "./parts";
import { Pill, SKIP_REASON_LABEL, formatDate, formatDuration } from "./shared";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 text-[13px] last:border-0">
      <span className="text-text-2">{label}</span>
      <b className="text-right font-semibold tabular-nums">{value}</b>
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
    <div className="grid gap-4 md:gap-5 lg:grid-cols-2">
      <Panel title="Strategy followed" help={`Copied from "${run.profileName}" when the backtest started. Changing the profile later doesn't affect this result.`} bodyClassName="px-4 py-1.5 md:px-5" flush>
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
        <Row label="Extra reaction time" value={s.fillLatencySeconds ? `${s.fillLatencySeconds}s` : "none"} />
        <Row label="Price checks" value={s.riskCheckIntervalSeconds ? `every ${s.riskCheckIntervalSeconds}s` : "every pool trade"} />
        <Row label="Fees" value={`${s.pumpFeePercent}% + ${formatUsd(s.jitoFeeUsd)} per trade`} />
      </Panel>

      <Panel title="Backtest data" aside={`${run.days}-day window, ${formatDate(run.windowStart)} – ${formatDate(run.windowEnd)}.`} bodyClassName="px-4 py-1.5 md:px-5" flush>
        <Row label="Read from" value={trader.collect.source === "api" ? "pump.fun user-trades (fast)" : trader.collect.source === "rpc" ? "the chain, over RPC" : "—"} />
        {trader.collect.source !== "api" && (
          <>
            <Row label="Transactions found" value={trader.collect.signaturesFound.toLocaleString()} />
            <Row label="Transactions read" value={`${trader.collect.signaturesProcessed.toLocaleString()} / ${trader.collect.signaturesToProcess.toLocaleString()}`} />
          </>
        )}
        {trader.collect.signaturesFailed > 0 && <Row label="Couldn't be fetched" value={<span className="text-warn">{trader.collect.signaturesFailed.toLocaleString()}</span>} />}
        <Row label="pump.fun trades found" value={trader.collect.tradesFound.toLocaleString()} />
        <Row label="Tokens simulated" value={`${trader.sim.signalsDone.toLocaleString()} / ${trader.sim.signalsTotal.toLocaleString()}`} />
        {skipped.length > 0 && (
          <div className="flex flex-col gap-2 py-3">
            <span className="text-xs text-text-3">
              Signals not traded
              <HelpTip>Buys the simulation did not copy, and why.</HelpTip>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {skipped.map(([k, label]) => (
                <Pill key={k}>
                  {label} · {trader.sim.skipped[k]}
                </Pill>
              ))}
            </div>
          </div>
        )}
        {detail.trader.stats.open > 0 && <Note className="pb-3">{detail.trader.stats.open} trade(s) were still open when the window ended and are marked at the last price.</Note>}
      </Panel>
    </div>
  );
}
