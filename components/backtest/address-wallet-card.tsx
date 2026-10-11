"use client";

import { AlertTriangle, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsd } from "@/lib/format";
import type { BacktestAddressDetail } from "@/lib/backtest-types";

function Stat({
  label,
  value,
  tone,
  emphasize,
  icon: Icon,
  hint,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  emphasize?: boolean;
  icon?: typeof TrendingUp;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={[
          "inline-flex items-center gap-1 font-mono tabular-nums",
          emphasize ? "text-xl font-semibold" : "text-base font-medium",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {Icon && <Icon className="size-3.5 shrink-0" />}
        {value}
      </span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

const toneOf = (n: number) => (n > 0 ? "positive" : n < 0 ? "negative" : undefined);
const iconOf = (n: number) => (n > 0 ? TrendingUp : n < 0 ? TrendingDown : undefined);

/** The simulated wallet this address would have had - the same numbers a live trader's "Simulated capital" card shows. */
export function AddressWalletCard({ wallet }: { wallet: BacktestAddressDetail["wallet"] }) {
  const total = wallet.realizedPnlUsd + wallet.unrealizedPnlUsd;
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-primary" /> Simulated capital
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Current balance" value={formatUsd(wallet.balanceUsd)} emphasize hint="Uncommitted cash only" />
          <Stat label="Wallet value" value={formatUsd(wallet.walletValueUsd)} emphasize hint="Balance + open trades, marked at the end of the window" />
          <Stat label="Starting allocation" value={formatUsd(wallet.startingUsd)} />
          <Stat label="Positions" value={`${wallet.openPositionCount} open / ${wallet.closedPositionCount} closed`} />
          <Stat label="Realized P&L" value={formatUsd(wallet.realizedPnlUsd)} tone={toneOf(wallet.realizedPnlUsd)} icon={iconOf(wallet.realizedPnlUsd)} />
          <Stat label="Unrealized P&L" value={formatUsd(wallet.unrealizedPnlUsd)} tone={toneOf(wallet.unrealizedPnlUsd)} icon={iconOf(wallet.unrealizedPnlUsd)} />
          <Stat label="Total P&L" value={formatUsd(total)} emphasize tone={toneOf(total)} icon={iconOf(total)} />
        </div>

        {wallet.negativeBalanceEventCount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Went negative {wallet.negativeBalanceEventCount} time{wallet.negativeBalanceEventCount === 1 ? "" : "s"} during this backtest - deepest point{" "}
              {formatUsd(-Math.abs(wallet.maxNegativeBalanceUsd))}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
