"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertOctagon, ChevronLeft, ChevronRight, Loader2, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressChip, formatAmount, formatPrice, PnlPill, signedUsd, TokenAvatar, toneClass, tokenLabel, TypePill } from "./shared";
import { getTradingLots, sellLotNow } from "@/lib/live-wallet-api";
import { formatExactTime, formatHeld, formatRelativeTime, formatUsd } from "@/lib/format";
import { styleLabel } from "@/lib/live-wallet-styles";
import { cn } from "@/lib/utils";
import type { LotDryExit, TradingLot, TradingLotsPage } from "@/lib/live-wallet-types";

const REASONS: Record<string, string> = {
  trader_sell: "Trader sold",
  stop_loss: "Stop-loss",
  take_profit: "Take-profit",
  trailing_stop: "Trailing stop",
  max_hold_time: "Max hold time",
  manual: "Sold by hand",
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
          <span className="text-xs text-muted-foreground">
            {reasonLabel(exit.reason)}
            {exit.at ? <span className="ml-1.5 tabular-nums">sold {formatExactTime(exit.at)}</span> : null}
          </span>
          <PnlPill usd={exit.pnlUsd} pct={exit.pnlPercent} />
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">would still be holding</span>
      )}
    </div>
  );
}

/** One copied trade: what the live wallet did next to what the simulation did, with the difference. */
const ROUTES: Record<string, string> = { direct: "direct", multihop: "multi-hop swap", pool: "via quote-token pool", jupiter: "via Jupiter", chain: "sold down its quote tokens in several transactions", estimate: "estimate" };

function LotCard({ lot, exitMode, walletId, onChanged }: { lot: TradingLot; exitMode: string; walletId: string; onChanged: () => void }) {
  const [selling, setSelling] = useState(false);
  async function sellNow() {
    setSelling(true);
    try {
      await sellLotNow(walletId, lot.id);
      toast.success("Sell queued");
      setTimeout(onChanged, 2500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue the sell");
    } finally {
      setSelling(false);
    }
  }
  const { live, sim } = lot;
  const dry = lot.mode === "dry";
  const open = lot.status === "open";
  const result = (value: number | null | undefined, pct: number | null | undefined, unrealized: boolean) =>
    value == null ? <span className="text-muted-foreground">-</span> : <span className={cn(toneClass(value))}>{signedUsd(value)} <span className="text-xs">({pct != null ? `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%` : "-"}{unrealized ? ", open" : ""})</span></span>;

  return (
    <Card className={cn("gap-3 p-4", lot.sellFailure && "border-negative/60")}>
      {lot.sellFailure ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-negative/10 px-3 py-2 text-[13px]">
          <span className="flex min-w-0 items-center gap-2 font-bold text-negative">
            <AlertOctagon className="size-4 shrink-0" />
            <span className="min-w-0">Sell failed - still held. {lot.sellFailure.reason}</span>
          </span>
          <Button size="sm" className="gap-1.5 bg-negative text-negative-foreground hover:bg-negative/90" disabled={selling} onClick={sellNow}>
            {selling ? <Loader2 className="size-4 animate-spin" /> : null} Sell now
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <TokenAvatar icon={lot.icon} symbol={lot.symbol} className="size-9" />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-extrabold">{tokenLabel(lot.symbol, lot.mint)}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span>token</span> <AddressChip value={lot.mint} label="token address" kind="token" chars={6} />
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span>trader</span> <AddressChip value={lot.traderAddress} label="trader address" chars={4} />
              </span>
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
          {!lot.paired ? <TypePill label="Simulation didn't take it - own entry rules" tone="neutral" /> : null}
          <span className="text-xs text-muted-foreground">{formatRelativeTime(lot.openedAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Side title={dry ? "Live (dry run)" : "Live"} tag={!live.verified && !dry ? <span className="text-[11px] text-muted-foreground">estimated</span> : undefined}>
          <Row label="Bought at">{formatPrice(live.buyPriceUsd)}</Row>
          <Row label={open ? "Value now" : "Sold at"}>{open ? (live.valueUsd != null ? formatUsd(live.valueUsd) : "-") : formatPrice(live.sellPriceUsd)}</Row>
          <Row label="Bought (UTC)">{formatExactTime(live.boughtAt)}</Row>
          <Row label="Sold (UTC)">{open ? "holding" : formatExactTime(live.soldAt)}</Row>
          <Row label="Cost">{formatUsd(live.costUsd)}</Row>
          <Row label="Fees (tip + network)">{formatUsd(live.tipUsd + live.feeUsd + (live.sellTipUsd ?? 0) + (live.sellFeeUsd ?? 0))}</Row>
          {live.assumedTipUsd > 0 ? <Row label="Assumed Jito fee (not spent)">{formatUsd(live.assumedTipUsd)}</Row> : null}
          <Row label="Result">{open ? result(live.unrealizedUsd, live.unrealizedPercent, true) : result(live.pnlUsd, live.pnlPercent, false)}</Row>
        </Side>
        <Side title={lot.scale !== 1 ? `Simulation (×${Number(lot.scale.toPrecision(3))} for comparing)` : "Simulation"}>
          {sim ? (
            <>
              <Row label="Bought at">{formatPrice(sim.buyPriceUsd)}</Row>
              <Row label={sim.status === "open" ? "Value now" : "Sold at"}>{sim.status === "open" ? (sim.valueUsd != null ? formatUsd(sim.valueUsd) : "-") : formatPrice(sim.sellPriceUsd)}</Row>
              <Row label="Bought (UTC)">{formatExactTime(sim.openedAt)}</Row>
              <Row label="Sold (UTC)">{sim.status === "open" ? "holding" : formatExactTime(sim.closedAt)}</Row>
              <Row label="Cost">{formatUsd(sim.costUsd)}</Row>
              <Row label="Exit">{sim.status === "open" ? "holding" : reasonLabel(sim.closeReason)}</Row>
              <Row label="Result">{sim.status === "open" ? result(sim.unrealizedUsd, sim.unrealizedPercent, true) : result(sim.pnlUsd, sim.pnlPercent, false)}</Row>
            </>
          ) : (
            <p className="py-3 text-center text-xs text-muted-foreground">The simulation did not take this trade.</p>
          )}
        </Side>
      </div>

      {live.soldAt && sim?.closedAt ? (
        <div className="flex items-center justify-between rounded-xl bg-secondary/40 px-3 py-1.5 text-[13px]">
          <span className="font-semibold text-muted-foreground">Live sold {new Date(live.soldAt) >= new Date(sim.closedAt) ? "after" : "before"} the simulation by</span>
          <span className="font-extrabold tabular-nums">{formatHeld(Math.abs(new Date(live.soldAt).getTime() - new Date(sim.closedAt).getTime()))}</span>
        </div>
      ) : null}

      {lot.differenceUsd != null ? (
        <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2 text-[13px]">
          <span className="font-semibold text-muted-foreground">Live minus simulation{lot.scale !== 1 ? " (at live size)" : ""}</span>
          <span className={cn("font-extrabold tabular-nums", toneClass(lot.differenceUsd))}>
            {signedUsd(lot.differenceUsd)}
            {lot.differencePercent != null ? <span className="ml-1.5 text-xs">({lot.differencePercent > 0 ? "+" : ""}{lot.differencePercent.toFixed(1)} pts)</span> : null}
          </span>
        </div>
      ) : null}

      {lot.dry ? (
        <div className="space-y-1.5">
          <div className="text-xs font-extrabold tracking-wide text-muted-foreground uppercase">What each exit way would have done</div>
          {Object.entries(lot.dry).map(([id, exit]) => (
            <ExitLine key={id} label={styleLabel(id)} exit={exit} chosen={exitMode === id} />
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{formatAmount(live.tokenAmount)} tokens</span>
        {live.venue ? <span>{live.venue === "curve" ? "bonding curve" : "PumpSwap pool"}{live.route && live.route !== "direct" ? `, ${ROUTES[live.route] ?? live.route}` : ""}</span> : null}
        {live.sendMode ? <span>{live.sendMode === "jito" ? "sent via Jito" : "sent raw"}</span> : null}
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
export function TradingLots({ walletId, exitMode, refreshKey }: { walletId: string; exitMode: string; refreshKey: number }) {
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
        <div className="grid gap-3 xl:grid-cols-2">{data?.lots.map((lot) => <LotCard key={lot.id} lot={lot} exitMode={exitMode} walletId={walletId} onChanged={load} />)}</div>
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
