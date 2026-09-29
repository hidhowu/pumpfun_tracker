"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Wallet, PlusCircle, TrendingUp, TrendingDown, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustBalance } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatUsd } from "@/lib/format";
import type { TraderDetail } from "@/lib/types";

type Props = {
  trader: TraderDetail;
  onAdjusted: (trader: TraderDetail) => void;
};

export function SimBalanceCard({ trader, onAdjusted }: Props) {
  const { currentProfileId } = useProfile();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { sim } = trader;
  const pnlPositive = sim.realizedPnlUsd > 0;
  const pnlNegative = sim.realizedPnlUsd < 0;
  const unrealized = trader.unrealizedPnlUsd;
  const unrealizedPositive = unrealized > 0;
  const unrealizedNegative = unrealized < 0;
  const totalPnl = sim.realizedPnlUsd + unrealized;
  const totalPositive = totalPnl > 0;
  const totalNegative = totalPnl < 0;

  async function handleSubmit() {
    if (!currentProfileId) return;
    const amountUsd = Number(amount);
    if (!amountUsd || Number.isNaN(amountUsd)) {
      toast.error("Enter a non-zero amount");
      return;
    }
    setSubmitting(true);
    try {
      const { balanceUsd } = await adjustBalance(currentProfileId, trader.address, amountUsd, reason.trim() || undefined);
      onAdjusted({ ...trader, sim: { ...sim, balanceUsd } });
      toast.success(`Balance ${amountUsd > 0 ? "topped up" : "reduced"} to ${formatUsd(balanceUsd)}`);
      setOpen(false);
      setAmount("");
      setReason("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to adjust balance");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-primary" /> Simulated capital
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <PlusCircle className="size-3.5" /> Add funds
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Adjust balance</DialogTitle>
              <DialogDescription>
                Positive to top up, negative to deduct. This is a manual adjustment, separate from trade P&amp;L.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount (USD)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 50 or -20"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">Reason (optional)</Label>
                <Input
                  id="reason"
                  placeholder="e.g. topping up for another round"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Apply
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Current balance" value={formatUsd(sim.balanceUsd)} emphasize hint="Uncommitted cash only" />
          <Stat label="Wallet value" value={formatUsd(trader.walletValueUsd)} emphasize hint="Balance + open positions, mark-to-market" />
          <Stat label="Starting allocation" value={formatUsd(sim.startingAllocationUsd)} />
          <Stat label="Positions" value={`${sim.openPositionCount} open / ${sim.closedPositionCount} closed`} />
          <Stat
            label="Realized P&L"
            value={formatUsd(sim.realizedPnlUsd)}
            tone={pnlPositive ? "positive" : pnlNegative ? "negative" : undefined}
            icon={pnlPositive ? TrendingUp : pnlNegative ? TrendingDown : undefined}
          />
          <Stat
            label="Unrealized P&L"
            value={formatUsd(unrealized)}
            tone={unrealizedPositive ? "positive" : unrealizedNegative ? "negative" : undefined}
            icon={unrealizedPositive ? TrendingUp : unrealizedNegative ? TrendingDown : undefined}
          />
          <Stat
            label="Total P&L"
            value={formatUsd(totalPnl)}
            emphasize
            tone={totalPositive ? "positive" : totalNegative ? "negative" : undefined}
            icon={totalPositive ? TrendingUp : totalNegative ? TrendingDown : undefined}
          />
        </div>

        {sim.negativeBalanceEventCount > 0 && (
          <div className="flex flex-col gap-1 rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-negative">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-3.5 shrink-0" />
              Went negative {sim.negativeBalanceEventCount} time{sim.negativeBalanceEventCount === 1 ? "" : "s"} (lifetime) - deepest
              point {formatUsd(-Math.abs(sim.maxNegativeBalanceUsd))}
            </div>
            {trader.todayNegativeBalance.count > 0 && (
              <div className="pl-5.5 text-negative/80">
                Today: {trader.todayNegativeBalance.count} time{trader.todayNegativeBalance.count === 1 ? "" : "s"} - deepest point{" "}
                {formatUsd(-Math.abs(trader.todayNegativeBalance.maxDepthUsd))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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
    <div className="flex flex-col gap-0.5">
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
        {Icon && <Icon className="size-3.5" />}
        {value}
      </span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}
