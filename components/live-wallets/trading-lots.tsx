"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressChip, formatAmount, formatPrice, PnlPill, signedUsd, TokenAvatar, toneClass, tokenLabel, TypePill } from "./shared";
import { getTradingLots } from "@/lib/live-wallet-api";
import { formatRelativeTime, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LotDryExit, TradingLot, TradingLotsPage } from "@/lib/live-wallet-types";

const REASONS: Record<string, string> = {
  trader_sell: "Trader sold",
  stop_loss: "Stop-loss",
  take_profit: "Take-profit",
  trailing_stop: "Trailing stop",
  max_hold_time: "Max hold time",
  blacklisted: "Trader blacklisted",
};
const reasonLabel = (reason: string | null | undefined) => (reason ? (REASONS[reason] ?? reason) : "-");

function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right font-bold tabular-nums", className)}>{children}</span>
    </div>
  );
}

function Side({ title, tag, children }: { title: string; tag?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold tracking-wide text-muted-foreground uppercase">{title}</span>
        {tag}
      </div>
      {children}
    </div>
  );
}

function ExitLine({ label, exit, chosen }: { label: string; exit: LotDryExit | null; chosen: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[13px]", chosen ? "bg-primary/10" : "bg-secondary/40")}>
      <span className="font-bold">
        {label}
        {chosen ? <span className="ml-1.5 text-[11px] font-semibold text-brand-soft">in use</span> : null}
      </span>
      {exit ? (
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{reasonLabel(exit.reason)}</span>
          <PnlPill usd={exit.pnlUsd} pct={exit.pnlPercent} />
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">still holding</span>
      )}
    </div>
  );
}

/** One copied trade: what the live wallet did next to what the simulation did, with the difference. */
function LotCard({ lot, exitMode }: { lot: TradingLot; exitMode: "own" | "follow" }) {
  const { live, sim } = lot;
  const dry = lot.mode === "dry";
  const open = lot.status === "open";
  const result = (value: number | null | undefined, pct: number | null | undefined, unrealized: boolean) =>
    value == null ? <span className="text-muted-foreground">-</span> : <span className={cn(toneClass(value))}>{signedUsd(value)} <span className="text-xs">({pct != null ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "-"}{unrealized ? ", open" : ""})</span></span>;

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TokenAvatar icon={lot.icon} symbol={lot.symbol} className="size-9" />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-extrabold">{tokenLabel(lot.symbol, lot.mint)}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>trader</span> <AddressChip value={lot.traderAddress} label="trader address" chars={4} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {dry ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-extrabold text-brand-soft">
              <TestTube2 className="size-3" /> Dry run
            </span>
          ) : null}
          <TypePill label={open ? "Open" : reasonLabel(lot.closeReason)} tone={open ? "receive" : "neutral"} />
          {!lot.paired ? <TypePill label="No simulated counterpart" tone="neutral" /> : null}
          <span className="text-xs text-muted-foreground">{formatRelativeTime(lot.openedAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Side title={dry ? "Live (dry run)" : "Live"} tag={!live.verified && !dry ? <span className="text-[11px] text-muted-foreground">estimated</span> : undefined}>
          <Row label="Bought at">{formatPrice(live.buyPriceUsd)}</Row>
          <Row label={open ? "Value now" : "Sold at"}>{open ? (live.valueUsd != null ? formatUsd(live.valueUsd) : "-") : formatPrice(live.sellPriceUsd)}</Row>
          <Row label="Cost">{formatUsd(live.costUsd)}</Row>
          <Row label="Fees (tip + network)">{formatUsd(live.tipUsd + live.feeUsd + (live.sellTipUsd ?? 0) + (live.sellFeeUsd ?? 0))}</Row>
          <Row label="Result">{open ? result(live.unrealizedUsd, live.unrealizedPercent, true) : result(live.pnlUsd, live.pnlPercent, false)}</Row>
        </Side>
        <Side title="Simulation">
          {sim ? (
            <>
              <Row label="Bought at">{formatPrice(sim.buyPriceUsd)}</Row>
              <Row label={sim.status === "open" ? "Value now" : "Sold at"}>{sim.status === "open" ? (sim.valueUsd != null ? formatUsd(sim.valueUsd) : "-") : formatPrice(sim.sellPriceUsd)}</Row>
              <Row label="Cost">{formatUsd(sim.costUsd)}</Row>
              <Row label="Exit">{sim.status === "open" ? "holding" : reasonLabel(sim.closeReason)}</Row>
              <Row label="Result">{sim.status === "open" ? result(sim.unrealizedUsd, sim.unrealizedPercent, true) : result(sim.pnlUsd, sim.pnlPercent, false)}</Row>
            </>
          ) : (
            <p className="py-3 text-center text-xs text-muted-foreground">The simulation did not take this trade.</p>
          )}
        </Side>
      </div>

      {lot.differenceUsd != null ? (
        <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-[13px]">
          <span className="font-semibold text-muted-foreground">Live minus simulation</span>
          <span className={cn("font-extrabold tabular-nums", toneClass(lot.differenceUsd))}>{signedUsd(lot.differenceUsd)}</span>
        </div>
      ) : null}

      {lot.dry ? (
        <div className="space-y-1.5">
          <div className="text-xs font-extrabold tracking-wide text-muted-foreground uppercase">What each exit way would have done</div>
          <ExitLine label="Its own entry" exit={lot.dry.own} chosen={exitMode === "own"} />
          <ExitLine label="Follow simulation" exit={lot.dry.follow} chosen={exitMode === "follow"} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{formatAmount(live.tokenAmount)} tokens</span>
        {live.venue ? <span>{live.venue === "curve" ? "bonding curve" : "PumpSwap pool"}</span> : null}
        {live.rentSol > 0 ? <span>{live.rentSol.toFixed(4)} SOL deposit (returned when the account is burned, not counted as a cost)</span> : null}
        {live.buySignature ? (
          <a href={`https://solscan.io/tx/${live.buySignature}`} target="_blank" rel="noreferrer" className="hover:text-primary">
            buy tx
          </a>
        ) : null}
        {live.sellSignature ? (
          <a href={`https://solscan.io/tx/${live.sellSignature}`} target="_blank" rel="noreferrer" className="hover:text-primary">
            sell tx
          </a>
        ) : null}
      </div>
    </Card>
  );
}

const FILTERS = [
  { value: undefined, label: "All" },
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
] as const;

/** The copied trades, newest first, each with the simulation's matching position beside it. */
export function TradingLots({ walletId, exitMode, refreshKey }: { walletId: string; exitMode: "own" | "follow"; refreshKey: number }) {
  const [status, setStatus] = useState<"open" | "closed" | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TradingLotsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getTradingLots(walletId, { status, page, limit: 12 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the trades");
    } finally {
      setLoading(false);
    }
  }, [walletId, status, page]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.label}
              size="sm"
              variant={status === f.value ? "default" : "outline"}
              onClick={() => {
                setStatus(f.value);
                setPage(1);
                setLoading(true);
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {data ? <span className="text-xs text-muted-foreground">{data.total.toLocaleString()} trade{data.total === 1 ? "" : "s"}</span> : null}
      </div>

      {loading && !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-60 w-full rounded-2xl" />
          <Skeleton className="h-60 w-full rounded-2xl" />
        </div>
      ) : error && !data ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
      ) : data && data.lots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          No trades yet. When the connected simulation wallet takes its next trade, it shows up here.
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">{data?.lots.map((lot) => <LotCard key={lot.id} lot={lot} exitMode={exitMode} />)}</div>
      )}

      {data && data.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm tabular-nums text-muted-foreground">
            {data.page} / {data.totalPages}
          </span>
          <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-4" />
          </Button>
          {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
        </div>
      ) : null}
    </div>
  );
}
