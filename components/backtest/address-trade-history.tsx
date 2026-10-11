"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Anchor, ChevronLeft, ChevronRight, Clock, ExternalLink, Gauge, History, ShieldAlert, Target, UserCheck, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBacktestPositions } from "@/lib/backtest-api";
import { formatAddress, formatTokenAmount, formatUsd } from "@/lib/format";
import type { BacktestCloseReason, BacktestPositionView } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { SKIP_REASON_LABEL, formatDateTime, formatDuration, formatSignedPercent, pnlTone } from "./shared";

const PAGE_SIZE = 20;

const CLOSE_REASON_META: Record<BacktestCloseReason, { label: string; icon: typeof UserCheck; className: string }> = {
  trader_sell: { label: "Trader sold", icon: UserCheck, className: "border-border/60 text-muted-foreground" },
  stop_loss: { label: "Stop-loss", icon: ShieldAlert, className: "border-negative/30 text-negative" },
  take_profit: { label: "Take-profit", icon: Target, className: "border-positive/30 text-positive" },
  trailing_stop: { label: "Trailing stop", icon: Waves, className: "border-primary/30 text-primary" },
  max_hold_time: { label: "Max hold time", icon: Clock, className: "border-border/60 text-muted-foreground" },
};

function CloseReasonBadge({ reason }: { reason: BacktestCloseReason | null }) {
  if (!reason) return <span className="text-muted-foreground">—</span>;
  const meta = CLOSE_REASON_META[reason] ?? { label: reason, icon: Anchor, className: "border-border/60 text-muted-foreground" };
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 whitespace-nowrap", meta.className)}>
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

function formatPrice(price: number | null): string {
  if (price == null) return "—";
  if (price === 0) return "$0";
  return `$${price < 0.01 ? price.toExponential(3) : price.toPrecision(4)}`;
}

function DetailRow({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium tabular-nums", className)}>{value}</span>
    </div>
  );
}

function TxLink({ label, signature, hint }: { label: string; signature: string | null; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {signature ? (
        <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary">
          {formatAddress(signature, 6)}
          <ExternalLink className="size-3" />
        </a>
      ) : (
        <span className="text-muted-foreground">{hint ?? "—"}</span>
      )}
    </div>
  );
}

/** Full detail of one simulated trade - the same rows as a live trader's trade dialog, plus the real trader's own legs. */
function TradeDetailDialog({ position, onClose }: { position: BacktestPositionView | null; onClose: () => void }) {
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <a href={`https://pump.fun/coin/${p.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-sm hover:text-primary">
              {formatAddress(p.mint, 6)}
              <ExternalLink className="size-3.5" />
            </a>
          </DialogTitle>
          <DialogDescription>Full detail for this simulated trade.</DialogDescription>
        </DialogHeader>

        {p.status === "skipped" ? (
          <div className="flex flex-col gap-3">
            <DetailRow label="Not traded because" value={SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason} />
            <DetailRow label="Trader bought" value={formatDateTime(p.traderBuyTime ? p.traderBuyTime * 1000 : null)} />
            <DetailRow label="Trader's buy size" value={p.traderBuyUsd != null ? formatUsd(p.traderBuyUsd) : "—"} />
            <TxLink label="Trader's buy" signature={p.traderBuySignature} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{p.status === "open" ? "Status" : "Closed by"}</span>
              {p.status === "open" ? (
                <Badge variant="outline" className="border-primary/30 text-primary">
                  Open at end
                </Badge>
              ) : (
                <CloseReasonBadge reason={p.closeReason} />
              )}
            </div>

            <Separator />

            <DetailRow label="Token amount" value={formatTokenAmount(p.tokenAmount)} />
            <DetailRow
              label="Buy price"
              value={
                <span className="inline-flex flex-col items-end">
                  <span>{formatPrice(p.buyPriceUsd)}</span>
                  {p.buyPriceSource === "prior_trade" && <span className="text-[11px] opacity-80">last known price</span>}
                </span>
              }
            />
            <DetailRow label={p.status === "open" ? "Mark price" : "Sell price"} value={formatPrice(p.status === "open" ? p.markPriceUsd : p.sellPriceUsd)} />

            <Separator />

            <DetailRow label="Amount spent (cost + fee)" value={formatUsd(spent)} />
            <DetailRow label="Buy fee" value={formatUsd(p.buyFeeUsd)} />
            {p.status === "closed" && (
              <>
                <DetailRow label="Proceeds (net of fee)" value={proceedsNet != null ? formatUsd(proceedsNet) : "—"} />
                <DetailRow label="Sell fee" value={formatUsd(p.sellFeeUsd)} />
              </>
            )}
            <DetailRow
              label={p.status === "open" ? "Unrealized P&L" : "Realized P&L"}
              value={
                <span className="inline-flex flex-col items-end">
                  <span>{formatUsd(pnlUsd)}</span>
                  <span className="text-[11px] opacity-80">{pnlPct != null ? `${pnlPct.toFixed(1)}%` : "-"}</span>
                </span>
              }
              className={pnlTone(pnlUsd)}
            />

            <Separator />

            <DetailRow
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Gauge className="size-3.5 text-muted-foreground" /> Peak {p.status === "open" ? "(so far)" : "(before close)"}
                </span>
              }
              value={
                peakPct != null ? (
                  <span className="inline-flex flex-col items-end">
                    <span>{formatUsd(peakUsd)}</span>
                    <span className="text-[11px] opacity-80">{peakPct.toFixed(1)}%</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
              className={pnlTone(peakPct)}
            />
            {givenBack !== null && givenBack > 0.5 && <p className="text-right text-[11px] text-muted-foreground">Gave back {givenBack.toFixed(1)} pts from peak before closing</p>}

            <DetailRow
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Gauge className="size-3.5 text-muted-foreground" /> Lowest {p.status === "open" ? "(so far)" : "(before close)"}
                </span>
              }
              value={
                lowPct != null ? (
                  <span className="inline-flex flex-col items-end">
                    <span>{formatUsd(lowUsd)}</span>
                    <span className="text-[11px] opacity-80">{lowPct.toFixed(1)}%</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
              className={pnlTone(lowPct)}
            />
            {recovered !== null && recovered > 0.5 && <p className="text-right text-[11px] text-muted-foreground">Recovered {recovered.toFixed(1)} pts from its low before closing</p>}

            <Separator />

            <DetailRow label="Opened" value={formatDateTime(p.openedAt)} />
            <DetailRow label={p.status === "open" ? "Window ended" : "Closed"} value={p.status === "open" ? "still held" : formatDateTime(p.closedAt)} />
            {held != null && <DetailRow label="Held for" value={formatDuration(held)} />}

            <Separator />

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">The real trader&apos;s transactions</span>
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

/** Closed trades (or the signals that were skipped), newest first. Click a row for the full detail. */
export function AddressTradeHistory({ runId, address, refreshKey }: { runId: string; address: string; refreshKey: number }) {
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

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" /> Trade history
          {data && <span className="text-xs font-normal text-muted-foreground">{data.total.toLocaleString()}</span>}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select
            value={view}
            onValueChange={(v) => {
              setView(v as View);
              setPage(1);
              setData(null);
            }}
          >
            <SelectTrigger size="sm" className="w-40" aria-label="Which trades to show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="closed">Closed trades</SelectItem>
              <SelectItem value="skipped">Skipped signals</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Button variant="outline" size="icon" className="size-7" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <Button variant="outline" size="icon" className="size-7" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {data === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data.positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            {view === "closed" ? "No closed trades yet" : "No skipped signals"}
          </div>
        ) : view === "closed" ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mint</TableHead>
                  <TableHead className="text-right">Realized P&amp;L</TableHead>
                  <TableHead className="text-right">Peak</TableHead>
                  <TableHead className="text-right">Lowest</TableHead>
                  <TableHead>Closed by</TableHead>
                  <TableHead className="text-right">Closed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <TableRow key={p._id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(p)}>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{formatAddress(p.mint, 5)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={cn("inline-flex flex-col items-end", pnlTone(p.realizedPnlUsd))}>
                        <span>{formatUsd(p.realizedPnlUsd)}</span>
                        <span className="text-[11px] opacity-80">{p.realizedPnlPercent != null ? `${p.realizedPnlPercent.toFixed(1)}%` : "-"}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={cn("inline-flex items-center justify-end gap-1", pnlTone(p.maxUnrealizedPnlPercent) ?? "text-muted-foreground")}>
                        <Gauge className="size-3 opacity-70" />
                        {formatSignedPercent(p.maxUnrealizedPnlPercent)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={cn("inline-flex items-center justify-end gap-1", pnlTone(p.minUnrealizedPnlPercent) ?? "text-muted-foreground")}>
                        <Gauge className="size-3 opacity-70" />
                        {formatSignedPercent(p.minUnrealizedPnlPercent)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <CloseReasonBadge reason={p.closeReason} />
                    </TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(p.closedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mint</TableHead>
                  <TableHead>Why it wasn&apos;t traded</TableHead>
                  <TableHead className="text-right">Their buy</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.positions.map((p) => (
                  <TableRow key={p._id} className="cursor-pointer hover:bg-muted/40" onClick={() => setSelected(p)}>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">{formatAddress(p.mint, 5)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-border/60 font-normal whitespace-nowrap text-muted-foreground">
                        {SKIP_REASON_LABEL[p.skipReason ?? "error"] ?? p.skipReason}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{p.traderBuyUsd != null ? formatUsd(p.traderBuyUsd) : "—"}</TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(p.traderBuyTime ? p.traderBuyTime * 1000 : null)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <TradeDetailDialog position={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
