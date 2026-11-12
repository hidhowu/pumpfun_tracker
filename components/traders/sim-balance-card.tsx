"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Wallet, CirclePlus, TrendingUp, TrendingDown, TriangleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustBalance } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
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
  const unrealized = trader.unrealizedPnlUsd;
  const totalPnl = sim.realizedPnlUsd + unrealized;

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
    <section className="overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5 md:py-4">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Wallet className="size-4 text-primary" /> Simulated capital
        </h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="max-md:h-9">
              <CirclePlus className="size-3.5" /> Add funds
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Adjust balance
                <HelpTip>Positive to top up, negative to deduct. A manual adjustment, separate from trade P&amp;L.</HelpTip>
              </DialogTitle>
              <DialogDescription className="sr-only">Top up or reduce this trader&apos;s simulated balance.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="amount">Amount (USD)</Label>
                <Input id="amount" type="number" step="0.01" placeholder="e.g. 50 or -20" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reason">
                  Reason <span className="text-text-3">(optional)</span>
                </Label>
                <Input id="reason" placeholder="e.g. topping up for another round" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" />}
                Apply
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col gap-5 p-4 md:p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4 md:gap-5">
          <Kv label="Current balance" value={formatUsd(sim.balanceUsd)} big hint="Uncommitted cash only" />
          <Kv label="Wallet value" value={formatUsd(trader.walletValueUsd)} big hint="Balance + open positions, mark-to-market" />
          <Kv label="Starting allocation" value={formatUsd(sim.startingAllocationUsd)} mono />
          <Kv label="Positions" value={`${sim.openPositionCount} open / ${sim.closedPositionCount} closed`} />
          <Kv label="Realized P&L" value={formatUsd(sim.realizedPnlUsd)} tone={toneOf(sim.realizedPnlUsd)} trend />
          <Kv label="Unrealized P&L" value={formatUsd(unrealized)} tone={toneOf(unrealized)} trend />
          <div className="max-md:col-span-2 max-md:border-t max-md:border-border max-md:pt-4 md:col-span-2">
            <Kv label="Total P&L" value={formatUsd(totalPnl)} big tone={toneOf(totalPnl)} trend />
          </div>
        </div>

        {sim.negativeBalanceEventCount > 0 && (
          <div className="flex flex-col gap-1 rounded-[14px] border border-destructive/30 bg-neg-soft px-3.5 py-3 text-[13px] text-[#ffc9d0]">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                Went negative {sim.negativeBalanceEventCount} time{sim.negativeBalanceEventCount === 1 ? "" : "s"} (lifetime) — deepest point {formatUsd(-Math.abs(sim.maxNegativeBalanceUsd))}
              </span>
            </div>
            {trader.todayNegativeBalance.count > 0 && (
              <div className="pl-6 opacity-85">
                Today: {trader.todayNegativeBalance.count} time{trader.todayNegativeBalance.count === 1 ? "" : "s"} — deepest point {formatUsd(-Math.abs(trader.todayNegativeBalance.maxDepthUsd))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function toneOf(value: number): "positive" | "negative" | undefined {
  return value > 0 ? "positive" : value < 0 ? "negative" : undefined;
}

function Kv({
  label,
  value,
  tone,
  big,
  mono,
  trend,
  hint,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  big?: boolean;
  mono?: boolean;
  trend?: boolean;
  hint?: string;
}) {
  const Icon = tone === "positive" ? TrendingUp : tone === "negative" ? TrendingDown : null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11.5px] text-text-3">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 tabular-nums",
          big ? "text-xl leading-[30px] font-semibold tracking-[-0.02em] md:text-2xl" : "text-base font-semibold md:text-lg",
          (big || mono) && "font-mono",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative"
        )}
      >
        {trend && Icon ? <Icon className={big ? "size-[18px]" : "size-3.5"} /> : null}
        <span className="truncate">{value}</span>
      </span>
      {hint ? <span className="text-xs text-text-3">{hint}</span> : null}
    </div>
  );
}
