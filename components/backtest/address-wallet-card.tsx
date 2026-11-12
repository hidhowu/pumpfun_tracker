"use client";

import { TriangleAlert, Wallet } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { formatUsd } from "@/lib/format";
import type { BacktestAddressDetail } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { Panel } from "./parts";

const tone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : undefined);
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function Fig({ label, value, hint, className, big }: { label: string; value: React.ReactNode; hint?: React.ReactNode; className?: string; big?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-text-3">{label}</span>
      <b className={cn("font-semibold tabular-nums", big ? "text-[22px] leading-7 tracking-[-0.02em]" : "text-sm", className)}>{value}</b>
      {hint ? <span className="text-xs text-text-3">{hint}</span> : null}
    </div>
  );
}

/** The simulated wallet this address would have had - the same numbers a live trader's "Simulated capital" card shows. */
export function AddressWalletCard({ wallet }: { wallet: BacktestAddressDetail["wallet"] }) {
  const total = wallet.realizedPnlUsd + wallet.unrealizedPnlUsd;
  return (
    <Panel title="Simulated capital" icon={<Wallet className="size-4 text-primary" />}>
      {/* Phone: the wallet value as a hero, then four small tiles. */}
      <div className="flex flex-col gap-3 md:hidden">
        <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface-2 px-4 py-3.5">
          <span className="text-sm text-text-2">Wallet value</span>
          <b className="text-[30px] leading-9 font-semibold tracking-[-0.025em] tabular-nums">{formatUsd(wallet.walletValueUsd)}</b>
          <span className="text-xs text-text-3">
            Balance {formatUsd(wallet.balanceUsd)} (uncommitted cash) · started {formatUsd(wallet.startingUsd)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5">
            <Fig label="Total P&L" value={signedUsd(total)} className={tone(total)} big />
          </div>
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5">
            <Fig label="Realized" value={signedUsd(wallet.realizedPnlUsd)} className={tone(wallet.realizedPnlUsd)} big />
          </div>
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5">
            <Fig label="Unrealized" value={signedUsd(wallet.unrealizedPnlUsd)} className={tone(wallet.unrealizedPnlUsd)} hint={`${wallet.openPositionCount} open`} big />
          </div>
          <div className="rounded-2xl border border-border bg-surface-2 p-3.5">
            <Fig label="Positions" value={wallet.closedPositionCount} hint="closed" big />
          </div>
        </div>
      </div>

      {/* Wide screens: three headline figures and a row of four. */}
      <div className="flex flex-col gap-5 max-md:hidden">
        <div className="grid grid-cols-3 gap-5">
          <Fig label="Current balance" value={formatUsd(wallet.balanceUsd)} hint="Uncommitted cash only" big />
          <Fig
            label="Wallet value"
            value={
              <>
                {formatUsd(wallet.walletValueUsd)}
                <HelpTip>Balance plus open trades, marked at the end of the window.</HelpTip>
              </>
            }
            big
          />
          <Fig label="Total P&L" value={signedUsd(total)} className={tone(total)} big />
        </div>
        <div className="grid grid-cols-4 gap-5">
          <Fig label="Starting allocation" value={formatUsd(wallet.startingUsd)} />
          <Fig label="Positions" value={`${wallet.openPositionCount} open / ${wallet.closedPositionCount} closed`} />
          <Fig label="Realized P&L" value={signedUsd(wallet.realizedPnlUsd)} className={tone(wallet.realizedPnlUsd)} />
          <Fig label="Unrealized P&L" value={signedUsd(wallet.unrealizedPnlUsd)} className={tone(wallet.unrealizedPnlUsd)} />
        </div>
      </div>

      {wallet.negativeBalanceEventCount > 0 && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-neg-soft px-3.5 py-2.5 text-[13px] text-[#ffc9d0]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            Went negative {wallet.negativeBalanceEventCount} time{wallet.negativeBalanceEventCount === 1 ? "" : "s"} during this backtest — deepest point {formatUsd(-Math.abs(wallet.maxNegativeBalanceUsd))}
          </span>
        </div>
      )}
    </Panel>
  );
}
