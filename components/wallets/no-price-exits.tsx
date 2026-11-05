"use client";

import { useEffect, useState } from "react";
import { Ban, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { getWalletNoPriceExits } from "@/lib/api";
import { formatAddress, formatExactTime, formatUsd } from "@/lib/format";
import type { NoPriceExit } from "@/lib/types";

/**
 * "Sold - no price available": the positions this wallet could not price anywhere (the tracking server's /price tried its own USD price, DexScreener up the
 * quote chain, and real trades' balances), so they were sold - or, if even the sale could not be priced, are still open. Collapsed by default; the count
 * is always visible. Each row has the token and the trader who bought it, to look into why it could not be priced.
 */
export function NoPriceExits({ walletId }: { walletId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ total: number; positions: NoPriceExit[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWalletNoPriceExits(walletId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [walletId]);

  const total = data?.total ?? 0;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">Sold - no price available</span>
          <span className="text-xs text-muted-foreground">
            Positions that could not be priced by any of the three ways, so they were sold (or are still open if even the sale could not be priced).
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
          {loading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : <span className={total > 0 ? "font-medium text-amber-500" : "text-muted-foreground"}>{total}</span>}
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3">
          {failed ? (
            <p className="text-xs text-muted-foreground">Couldn&apos;t load the list.</p>
          ) : total === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Ban className="size-3.5" /> Nothing so far - every position of this wallet has had a price.
            </p>
          ) : (
            data!.positions.map((p) => (
              <div key={p.id} className="flex flex-col gap-1 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1 font-mono">
                    {formatAddress(p.mint, 6)} <CopyButton value={p.mint} label="token address" />
                  </span>
                  <span className={p.status === "open" ? "text-amber-500" : "text-muted-foreground"}>
                    {p.status === "open" ? "still open" : `sold ${formatExactTime(p.closedAt)}`}
                    {p.status === "closed" && p.realizedPnlUsd !== null ? ` · ${formatUsd(p.realizedPnlUsd)}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                  <span className="flex items-center gap-1">
                    bought by <span className="font-mono">{formatAddress(p.traderAddress, 6)}</span> <CopyButton value={p.traderAddress} label="trader address" />
                  </span>
                  <span>opened {formatExactTime(p.openedAt)}</span>
                </div>
                {p.reason && <p className="text-muted-foreground">Why: {p.reason}</p>}
              </div>
            ))
          )}
          {total > (data?.positions.length ?? 0) && <p className="text-xs text-muted-foreground">Showing the newest {data!.positions.length} of {total}.</p>}
        </div>
      )}
    </div>
  );
}
