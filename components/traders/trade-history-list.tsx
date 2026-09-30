"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Anchor,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Gauge,
  History,
  ShieldAlert,
  Target,
  UserCheck,
  Waves,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getPositions } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress, formatRelativeTime, formatTokenAmount, formatUsd } from "@/lib/format";
import type { SimPosition } from "@/lib/types";

type Props = { address: string };

const CLOSE_REASON_META: Record<
  NonNullable<SimPosition["closeReason"]>,
  { label: string; icon: typeof UserCheck; className: string }
> = {
  trader_sell: { label: "Trader sold", icon: UserCheck, className: "border-border/60 text-muted-foreground" },
  stop_loss: { label: "Stop-loss", icon: ShieldAlert, className: "border-negative/30 text-negative" },
  take_profit: { label: "Take-profit", icon: Target, className: "border-positive/30 text-positive" },
  bench: { label: "Bench", icon: Anchor, className: "border-primary/30 text-primary" },
  trailing_stop: { label: "Trailing stop", icon: Waves, className: "border-primary/30 text-primary" },
  max_hold_time: { label: "Max hold time", icon: Clock, className: "border-border/60 text-muted-foreground" },
};

function CloseReasonBadge({ reason }: { reason: SimPosition["closeReason"] }) {
  if (!reason) return <span className="text-muted-foreground">—</span>;
  const meta = CLOSE_REASON_META[reason];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${meta.className}`}>
      <Icon className="size-3" />
      {meta.label}
    </Badge>
  );
}

function TxLink({ label, signature }: { label: string; signature: string | null }) {
  if (!signature) {
    return (
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">—</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <a
        href={`https://solscan.io/tx/${signature}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono text-xs hover:text-primary"
      >
        {formatAddress(signature, 6)}
        <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

function DetailRow({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium tabular-nums ${className ?? ""}`}>{value}</span>
    </div>
  );
}

function TradeDetailDialog({ position, onClose }: { position: SimPosition | null; onClose: () => void }) {
  if (!position) return null;
  const pnlPositive = (position.realizedPnlUsd || 0) > 0;
  const pnlNegative = (position.realizedPnlUsd || 0) < 0;
  const spent = position.costBasisUsd + position.buyFeeUsd;
  const proceedsNet = position.proceedsUsd !== null && position.sellFeeUsd !== null ? position.proceedsUsd - position.sellFeeUsd : null;
  const peakPercent = position.maxUnrealizedPnlPercent;
  const hasPeak = peakPercent != null;
  const peakPositive = peakPercent != null && peakPercent > 0;
  const peakNegative = peakPercent != null && peakPercent < 0;
  // How much of the peak gain was given back by the time it actually closed
  // - e.g. peaked at +100%, closed at +40% => "gave back 60 pts from peak".
  const givenBackPts =
    peakPercent != null && position.realizedPnlPercent !== null ? peakPercent - position.realizedPnlPercent : null;
  const lowestPercent = position.minUnrealizedPnlPercent;
  const lowestPositive = lowestPercent != null && lowestPercent > 0;
  const lowestNegative = lowestPercent != null && lowestPercent < 0;
  // How much it recovered from its lowest point by the time it actually
  // closed - e.g. dipped to -50%, closed at +10% => "recovered 60 pts from the low".
  const recoveredPts =
    lowestPercent != null && position.realizedPnlPercent !== null ? position.realizedPnlPercent - lowestPercent : null;

  return (
    <Dialog open={!!position} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <a
              href={`https://pump.fun/coin/${position.mint}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-sm hover:text-primary"
            >
              {formatAddress(position.mint, 6)}
              <ExternalLink className="size-3.5" />
            </a>
          </DialogTitle>
          <DialogDescription>Full detail for this simulated trade.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Closed by</span>
            <CloseReasonBadge reason={position.closeReason} />
          </div>

          <Separator />

          <DetailRow label="Token amount" value={formatTokenAmount(position.tokenAmount)} />
          <DetailRow label="Buy price" value={formatUsd(position.buyPriceUsd)} />
          <DetailRow label="Sell price" value={position.sellPriceUsd !== null ? formatUsd(position.sellPriceUsd) : "—"} />

          <Separator />

          <DetailRow label="Amount spent (cost + fee)" value={formatUsd(spent)} />
          <DetailRow label="Proceeds (net of fee)" value={proceedsNet !== null ? formatUsd(proceedsNet) : "—"} />
          <DetailRow
            label="Realized P&L"
            value={
              <span className="inline-flex flex-col items-end">
                <span>{formatUsd(position.realizedPnlUsd)}</span>
                <span className="text-[11px] opacity-80">
                  {position.realizedPnlPercent !== null ? `${position.realizedPnlPercent.toFixed(1)}%` : "-"}
                </span>
              </span>
            }
            className={pnlPositive ? "text-positive" : pnlNegative ? "text-negative" : undefined}
          />

          <Separator />

          <DetailRow
            label={
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="size-3.5 text-muted-foreground" /> Peak (before close)
              </span>
            }
            value={
              peakPercent != null ? (
                <span className="inline-flex flex-col items-end">
                  <span>{formatUsd(position.maxUnrealizedPnlUsd)}</span>
                  <span className="text-[11px] opacity-80">{peakPercent.toFixed(1)}%</span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            className={peakPositive ? "text-positive" : peakNegative ? "text-negative" : undefined}
          />
          {givenBackPts !== null && givenBackPts > 0.5 && (
            <p className="text-right text-[11px] text-muted-foreground">
              Gave back {givenBackPts.toFixed(1)} pts from peak before closing
            </p>
          )}

          <DetailRow
            label={
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="size-3.5 text-muted-foreground" /> Lowest (before close)
              </span>
            }
            value={
              lowestPercent != null ? (
                <span className="inline-flex flex-col items-end">
                  <span>{formatUsd(position.minUnrealizedPnlUsd)}</span>
                  <span className="text-[11px] opacity-80">{lowestPercent.toFixed(1)}%</span>
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            className={lowestPositive ? "text-positive" : lowestNegative ? "text-negative" : undefined}
          />
          {recoveredPts !== null && recoveredPts > 0.5 && (
            <p className="text-right text-[11px] text-muted-foreground">
              Recovered {recoveredPts.toFixed(1)} pts from its low before closing
            </p>
          )}

          <Separator />

          <DetailRow label="Opened" value={formatRelativeTime(position.openedAt)} />
          <DetailRow label="Closed" value={formatRelativeTime(position.closedAt)} />

          <Separator />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">On-chain trigger transactions</span>
            <TxLink label="Buy trigger" signature={position.openTriggerSignature} />
            <TxLink label="Sell trigger" signature={position.closeTriggerSignature} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TradeHistoryList({ address }: Props) {
  const { currentProfileId } = useProfile();
  const [positions, setPositions] = useState<SimPosition[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SimPosition | null>(null);

  const load = useCallback(
    async (targetPage: number) => {
      if (!currentProfileId) return;
      setLoading(true);
      try {
        const res = await getPositions(currentProfileId, address, "closed", targetPage, 20);
        setPositions(res.positions);
        setTotalPages(Math.max(1, res.totalPages));
      } finally {
        setLoading(false);
      }
    },
    [currentProfileId, address]
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" /> Trade history
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && positions.length === 0 ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            No closed trades yet
          </div>
        ) : (
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
                {positions.map((position) => {
                  const pnlPositive = (position.realizedPnlUsd || 0) > 0;
                  const pnlNegative = (position.realizedPnlUsd || 0) < 0;
                  const peakPercent = position.maxUnrealizedPnlPercent;
                  const peakPositive = peakPercent != null && peakPercent > 0;
                  const peakNegative = peakPercent != null && peakPercent < 0;
                  const lowestPercent = position.minUnrealizedPnlPercent;
                  const lowestPositive = lowestPercent != null && lowestPercent > 0;
                  const lowestNegative = lowestPercent != null && lowestPercent < 0;
                  return (
                    <TableRow
                      key={position._id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setSelected(position)}
                    >
                      <TableCell>
                        <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                          {formatAddress(position.mint, 5)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={[
                            "inline-flex flex-col items-end",
                            pnlPositive && "text-positive",
                            pnlNegative && "text-negative",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span>{formatUsd(position.realizedPnlUsd)}</span>
                          <span className="text-[11px] opacity-80">
                            {position.realizedPnlPercent !== null ? `${position.realizedPnlPercent.toFixed(1)}%` : "-"}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={[
                            "inline-flex items-center justify-end gap-1",
                            peakPositive && "text-positive",
                            peakNegative && "text-negative",
                            peakPercent == null && "text-muted-foreground",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <Gauge className="size-3 opacity-70" />
                          {peakPercent != null ? `${peakPercent.toFixed(1)}%` : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={[
                            "inline-flex items-center justify-end gap-1",
                            lowestPositive && "text-positive",
                            lowestNegative && "text-negative",
                            lowestPercent == null && "text-muted-foreground",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <Gauge className="size-3 opacity-70" />
                          {lowestPercent != null ? `${lowestPercent.toFixed(1)}%` : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <CloseReasonBadge reason={position.closeReason} />
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatRelativeTime(position.closedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <TradeDetailDialog position={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}
