"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Anchor, ArrowUpRight, ChevronLeft, ChevronRight, Clock, ExternalLink, Gauge, History, ShieldAlert, Target, UserCheck, Waves } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBacktestPositions } from "@/lib/backtest-api";
import { formatAddress, formatTokenAmount, formatUsd } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { BacktestCloseReason, BacktestPositionView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { EmptyNote } from "./parts";
import { Pill, SKIP_REASON_LABEL, formatDateTime, formatDuration, formatSignedPercent, pnlTone } from "./shared";

const PAGE_SIZE = 20;
const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";

const CLOSE_REASON_META: Record<BacktestCloseReason, { label: string; icon: typeof UserCheck; className: string }> = {
  trader_sell: { label: "Trader sold", icon: UserCheck, className: "border-line-2 bg-surface-3 text-text-2" },
  stop_loss: { label: "Stop-loss", icon: ShieldAlert, className: "border-destructive/30 bg-neg-soft text-destructive" },
  take_profit: { label: "Take-profit", icon: Target, className: "border-positive/30 bg-pos-soft text-positive" },
  trailing_stop: { label: "Trailing stop", icon: Waves, className: "border-volt-line bg-volt-soft text-primary" },
  max_hold_time: { label: "Max hold time", icon: Clock, className: "border-warn/30 bg-warn-soft text-warn" },
};

function CloseReasonBadge({ reason }: { reason: BacktestCloseReason | null }) {
  if (!reason) return <span className="text-text-3">—</span>;
  const meta = CLOSE_REASON_META[reason] ?? { label: reason, icon: Anchor, className: "border-line-2 bg-surface-3 text-text-2" };
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap", meta.className)}>
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

function formatPrice(price: number | null): string {
  if (price == null) return "—";
  if (price === 0) return "$0";
  return `$${price < 0.01 ? price.toExponential(3) : price.toPrecision(4)}`;
}

const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function MintChip({ mint }: { mint: string }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
      <a href={`https://pump.fun/coin/${mint}`} onClick={(e) => e.stopPropagation()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        {formatAddress(mint, 5)}
        <ArrowUpRight className="size-3" />
      </a>
      <CopyButton value={mint} label="token address" />
    </span>
  );
}

function DetailRow({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-[34px] items-center justify-between gap-4 text-[13.5px]">
      <span className="text-text-2">{label}</span>
      <span className={cn("text-right font-medium tabular-nums", className)}>{value}</span>
    </div>
  );
}

const Sep = () => <div className="my-0.5 h-px bg-border" />;

/** Value with a small second line underneath ("+$56.00" over "+223.0%"). */
function Stacked({ top, bottom }: { top: React.ReactNode; bottom?: React.ReactNode }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{top}</span>
      {bottom ? <small className="text-[11px] font-normal opacity-80">{bottom}</small> : null}
    </span>
  );
}

function TxLink({ label, signature, hint }: { label: string; signature: string | null; hint?: string }) {
  return (
    <div className="flex min-h-[30px] items-center justify-between gap-3 text-[13.5px]">
      <span className="text-text-2">{label}</span>
      {signature ? (
        <span className="inline-flex items-center gap-1.5">
          <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary">
            {formatAddress(signature, 6)}
            <ExternalLink className="size-3 text-text-3" />
          </a>
          <CopyButton value={signature} label="transaction signature" />
        </span>
      ) : (
        <span className="text-text-3">{hint ?? "—"}</span>
      )}
    </div>
  );
}

/** Full detail of one simulated trade - the same rows as a live trader's trade dialog, plus the real trader's own legs. */
export function TradeDetailDialog({ position, onClose }: { position: BacktestPositionView | null; onClose: () => void }) {
  if (!position) return null;
  const p = position;
  const spent = (p.costBasisUsd ?? 0) + (p.buyFeeUsd ?? 0);
  const proceedsNet = p.proceedsUsd != null && p.sellFeeUsd != null ? p.proceedsUsd - p.sellFeeUsd : null;
  const peakPct = p.maxUnrealizedPnlPercent;
  const lowPct = p.minUnrealizedPnlPercent;
  const peakUsd = peakPct != null ? (spent * peakPct) / 100 : null;
  const lowUsd = lowPct != null ? (spent * lowPct) / 100 : null;
  const givenBack = peakPct != null && p.realizedPnlPercent != null ? peakPct - p.realizedPnlPercent : null;
  const recovered = lowPct != null && p.realizedPnlPercent != null ? p.realizedPnlPercent - lowPct : null;
  const pnlUsd = p.status === "open" ? p.unrealizedPnlUsd : p.realizedPnlUsd;
  const pnlPct = p.status === "open" ? p.unrealizedPnlPercent : p.realizedPnlPercent;
  const held = p.openedAt && p.closedAt ? new Date(p.closedAt).getTime() - new Date(p.openedAt).getTime() : null;
  const open = p.status === "open";

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <a href={`https://pump.fun/coin/${p.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-mono text-base hover:text-primary">
              {formatAddress(p.mint, 6)}
              <ExternalLink className="size-3.5 text-text-3" />
            </a>
            <CopyButton value={p.mint} label="token address" />
          </DialogTitle>
          <DialogDescription>{p.status === "skipped" ? "A buy signal this simulation did not copy." : "Full detail for this simulated trade."}</DialogDescription>
        </DialogHeader>

        {p.status === "skipped" ? (
          <div className="flex flex-col gap-0.5">
            <DetailRow label="Not traded because" value={SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason} />
            <Sep />
            <DetailRow label="Trader bought" value={p.traderBuyTime ? `${formatDateTime(p.traderBuyTime * 1000)} UTC` : "—"} />
            <DetailRow label="Trader's buy size" value={p.traderBuyUsd != null ? formatUsd(p.traderBuyUsd) : "—"} />
            <Sep />
            <div className="flex flex-col gap-1 pt-1">
              <span className="text-xs font-medium text-text-3">On-chain trigger transaction</span>
              <TxLink label="Trader's buy" signature={p.traderBuySignature} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <div className="flex min-h-[34px] items-center justify-between gap-4 text-[13.5px]">
              <span className="text-text-2">{open ? "Status" : "Closed by"}</span>
              {open ? <Pill tone="volt">Open at end</Pill> : <CloseReasonBadge reason={p.closeReason} />}
            </div>
            <Sep />
            <DetailRow label="Token amount" value={formatTokenAmount(p.tokenAmount)} />
            <DetailRow
              label="Buy price"
              value={<Stacked top={formatPrice(p.buyPriceUsd)} bottom={p.buyPriceSource === "prior_trade" ? "last known price" : undefined} />}
            />
            <DetailRow label={open ? "Mark price" : "Sell price"} value={formatPrice(open ? p.markPriceUsd : p.sellPriceUsd)} />
            <Sep />
            <DetailRow label="Amount spent (cost + fee)" value={formatUsd(spent)} />
            <DetailRow label="Buy fee" value={formatUsd(p.buyFeeUsd)} />
            {!open && (
              <>
                <DetailRow label="Proceeds (net of fee)" value={proceedsNet != null ? formatUsd(proceedsNet) : "—"} />
                <DetailRow label="Sell fee" value={formatUsd(p.sellFeeUsd)} />
              </>
            )}
            <DetailRow
              label={open ? "Unrealized P&L" : "Realized P&L"}
              value={<Stacked top={pnlUsd != null ? signedUsd(pnlUsd) : "—"} bottom={pnlPct != null ? formatSignedPercent(pnlPct) : "-"} />}
              className={pnlTone(pnlUsd)}
            />
            <Sep />
            <DetailRow
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Gauge className="size-3.5 text-text-3" /> Peak {open ? "(so far)" : "(before close)"}
                </span>
              }
              value={peakPct != null ? <Stacked top={formatUsd(peakUsd)} bottom={`${peakPct.toFixed(1)}%`} /> : <span className="text-text-3">—</span>}
              className={pnlTone(peakPct)}
            />
            {givenBack !== null && givenBack > 0.5 && <p className="-mt-1.5 text-right text-[11px] text-text-3">Gave back {givenBack.toFixed(1)} pts from peak before closing</p>}
            <DetailRow
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Gauge className="size-3.5 text-text-3" /> Lowest {open ? "(so far)" : "(before close)"}
                </span>
              }
              value={lowPct != null ? <Stacked top={formatUsd(lowUsd)} bottom={`${lowPct.toFixed(1)}%`} /> : <span className="text-text-3">—</span>}
              className={pnlTone(lowPct)}
            />
            {recovered !== null && recovered > 0.5 && <p className="-mt-1.5 text-right text-[11px] text-text-3">Recovered {recovered.toFixed(1)} pts from its low before closing</p>}
            <Sep />
            <DetailRow label="Trader bought" value={p.traderBuyTime ? `${formatDateTime(p.traderBuyTime * 1000)} UTC` : "—"} />
            <DetailRow label="Bought at (our fill)" value={p.openedAt ? `${formatDateTime(p.openedAt)} UTC` : "—"} />
            {!open && <DetailRow label="Exit decided" value={p.closeSignalAt ? `${formatDateTime(p.closeSignalAt)} UTC` : "—"} />}
            {!open && p.closeReason === "trader_sell" && <DetailRow label="Trader sold" value={p.traderSellTime ? `${formatDateTime(p.traderSellTime * 1000)} UTC` : "—"} />}
            <DetailRow label={open ? "Window ended" : "Sold at (our fill)"} value={open ? "still held" : p.closedAt ? `${formatDateTime(p.closedAt)} UTC` : "—"} />
            {held != null && <DetailRow label="Held for" value={formatDuration(held)} />}
            <Sep />
            <div className="flex flex-col gap-1 pt-1">
              <span className="text-xs font-medium text-text-3">The real trader&apos;s transactions</span>
              <DetailRow label="Their buy size" value={p.traderBuyUsd != null ? formatUsd(p.traderBuyUsd) : "—"} />
              <TxLink label="Buy trigger" signature={p.traderBuySignature} />
              <TxLink label="Sell trigger" signature={p.traderSellSignature} hint={p.closeReason === "trader_sell" ? "—" : "didn't drive the exit"} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type View = "closed" | "skipped";
const VIEWS = [
  { value: "closed", label: "Closed trades" },
  { value: "skipped", label: "Skipped signals" },
] as const;

function PeakLow({ value }: { value: number | null }) {
  return (
    <span className={cn("inline-flex items-center justify-end gap-1", value == null ? "text-text-3" : pnlTone(value))}>
      <Gauge className="size-3 opacity-80" />
      {value == null ? "—" : formatSignedPercent(value)}
    </span>
  );
}

/** Closed trades (or the signals that were skipped), newest first. Click a row for the full detail. */
export function AddressTradeHistory({ runId, address, refreshKey }: { runId: string; address: string; refreshKey: number }) {
  const phone = !useMediaQuery("(min-width: 768px)");
  const [view, setView] = useState<View>("closed");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ positions: BacktestPositionView[]; total: number; totalPages: number } | null>(null);
  const [selected, setSelected] = useState<BacktestPositionView | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBacktestPositions(runId, { address, status: view, page, limit: PAGE_SIZE })
      .then((res) => !cancelled && setData(res))
      .catch((e) => !cancelled && toast.error(e instanceof Error ? e.message : "Failed to load trades"));
    return () => {
      cancelled = true;
    };
  }, [runId, address, view, page, refreshKey]);

  const totalPages = data?.totalPages ?? 1;

  const pager = (
    <div className="flex items-center gap-2 text-xs text-text-2">
      <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
        <ChevronLeft />
      </Button>
      <span className="tabular-nums">
        {page} / {totalPages}
      </span>
      <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
        <ChevronRight />
      </Button>
    </div>
  );

  return (
    <section className="flex flex-col overflow-hidden rounded-[20px] border-border bg-card max-md:gap-3 max-md:border-0 max-md:bg-transparent md:border">
      <div className="flex flex-wrap items-center gap-3 border-border md:border-b md:px-5 md:py-3.5">
        <b className="flex items-center gap-2 text-[15px] font-semibold max-md:hidden">
          <History className="size-4 text-primary" /> Trade history
        </b>
        {data && <span className="inline-flex h-[22px] items-center rounded-full border border-volt-line bg-volt-soft px-2 text-[11.5px] font-medium text-primary max-md:hidden">{data.total.toLocaleString()}</span>}
        <div className="flex-1 max-md:hidden" />
        <Segmented
          options={VIEWS}
          value={view}
          onChange={(v) => {
            setView(v);
            setPage(1);
            setData(null);
          }}
          label="Which trades to show"
          block={phone}
          tall={phone}
        />
        {data && data.totalPages > 1 && <div className={cn(phone && "flex w-full items-center justify-between")}>{phone && <span className="text-xs text-text-3">{data.total.toLocaleString()} total</span>}{pager}</div>}
      </div>

      {data === null ? (
        <div className="flex flex-col gap-2.5 md:p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : data.positions.length === 0 ? (
        <EmptyNote icon={<History className="size-5" />}>{view === "closed" ? "No closed trades yet." : "No skipped signals."}</EmptyNote>
      ) : (
        <>
          {/* Phone: one card per trade. */}
          <div className="flex flex-col gap-3 md:hidden">
            {data.positions.map((p) => (
              <article key={p._id} role="button" tabIndex={0} onClick={() => setSelected(p)} onKeyDown={(e) => e.key === "Enter" && setSelected(p)} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <MintChip mint={p.mint} />
                  {view === "closed" ? (
                    p.realizedPnlUsd != null ? (
                      <span className="flex flex-col items-end leading-[1.3]">
                        <b className={cn("font-semibold tabular-nums", pnlTone(p.realizedPnlUsd))}>{signedUsd(p.realizedPnlUsd)}</b>
                        <span className={cn("text-xs tabular-nums", pnlTone(p.realizedPnlPercent))}>{formatSignedPercent(p.realizedPnlPercent)}</span>
                      </span>
                    ) : (
                      <span className="text-text-3">—</span>
                    )
                  ) : (
                    <b className="font-semibold tabular-nums">{p.traderBuyUsd != null ? formatUsd(p.traderBuyUsd) : "—"}</b>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-text-3">
                  <span>{view === "closed" ? (p.closeReason ? CLOSE_REASON_META[p.closeReason]?.label ?? p.closeReason : "—") : (SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason)}</span>
                  <span>{view === "closed" ? formatDateTime(p.closedAt) : formatDateTime(p.traderBuyTime ? p.traderBuyTime * 1000 : null)}</span>
                </div>
              </article>
            ))}
          </div>

          {/* Wide screens: the table. */}
          <div className="max-md:hidden">
            {view === "closed" ? (
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className={cn(headCls, "pl-5")}>Mint</TableHead>
                    <TableHead className={cn(headCls, "text-right")}>Realized P&amp;L</TableHead>
                    <TableHead className={cn(headCls, "text-right")}>Peak</TableHead>
                    <TableHead className={cn(headCls, "text-right")}>Lowest</TableHead>
                    <TableHead className={headCls}>Closed by</TableHead>
                    <TableHead className={cn(headCls, "pr-5 text-right")}>Closed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.positions.map((p) => (
                    <TableRow key={p._id} className="h-[60px] cursor-pointer border-border" onClick={() => setSelected(p)}>
                      <TableCell className="pl-5">
                        <MintChip mint={p.mint} />
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        {p.realizedPnlUsd != null ? (
                          <span className={cn("inline-flex flex-col items-end leading-[1.3]", pnlTone(p.realizedPnlUsd))}>
                            <b className="font-semibold">{signedUsd(p.realizedPnlUsd)}</b>
                            <span className="text-xs">{formatSignedPercent(p.realizedPnlPercent)}</span>
                          </span>
                        ) : (
                          <span className="text-text-3">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <PeakLow value={p.maxUnrealizedPnlPercent} />
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">
                        <PeakLow value={p.minUnrealizedPnlPercent} />
                      </TableCell>
                      <TableCell>
                        <CloseReasonBadge reason={p.closeReason} />
                      </TableCell>
                      <TableCell className="pr-5 text-right text-xs whitespace-nowrap text-text-3">{formatDateTime(p.closedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className={cn(headCls, "pl-5")}>Mint</TableHead>
                    <TableHead className={headCls}>Why it wasn&apos;t traded</TableHead>
                    <TableHead className={cn(headCls, "text-right")}>Their buy</TableHead>
                    <TableHead className={cn(headCls, "pr-5 text-right")}>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.positions.map((p) => (
                    <TableRow key={p._id} className="h-[60px] cursor-pointer border-border" onClick={() => setSelected(p)}>
                      <TableCell className="pl-5">
                        <MintChip mint={p.mint} />
                      </TableCell>
                      <TableCell>
                        <Pill>{SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason}</Pill>
                      </TableCell>
                      <TableCell className="text-right text-[13px] tabular-nums">{p.traderBuyUsd != null ? formatUsd(p.traderBuyUsd) : "—"}</TableCell>
                      <TableCell className="pr-5 text-right text-xs whitespace-nowrap text-text-3">{formatDateTime(p.traderBuyTime ? p.traderBuyTime * 1000 : null)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}

      <TradeDetailDialog position={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
