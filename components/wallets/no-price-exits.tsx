"use client";

import { useEffect, useState } from "react";
import { Ban, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { HelpTip } from "@/components/ui/help-tip";
import { getWalletNoPriceExits } from "@/lib/api";
import { formatAddress, formatExactTime, formatUsd } from "@/lib/format";
import type { NoPriceExit } from "@/lib/types";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[14px] border border-border bg-surface-2 px-3.5 py-3 text-left transition-colors hover:border-line-3"
        aria-expanded={open}
      >
        <b className="min-w-0 text-[13px] font-semibold">
          Sold — no price available
          <HelpTip>Positions no source could price, so they were sold (or stay open if even the sale couldn&apos;t be priced). Every price source came back empty.</HelpTip>
        </b>
        <span className="flex shrink-0 items-center gap-2 text-sm tabular-nums">
          {loading ? <Loader2 className="size-3.5 animate-spin text-text-3" /> : <b className={cn("font-semibold", total > 0 ? "text-warn" : "text-text-3")}>{total}</b>}
          {open ? <ChevronDown className="size-4 text-text-3" /> : <ChevronRight className="size-4 text-text-3" />}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2.5">
          {failed ? (
            <p className="text-xs text-text-2">Couldn&apos;t load the list.</p>
          ) : total === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-text-2">
              <Ban className="size-3.5" /> Nothing so far — every position of this wallet has had a price.
            </p>
          ) : (
            data!.positions.map((p) => (
              <div key={p.id} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1 font-mono text-[13px]">
                    {formatAddress(p.mint, 6)} <CopyButton value={p.mint} label="token address" />
                  </span>
                  <span className={p.status === "open" ? "text-warn" : "text-text-3"}>
                    {p.status === "open" ? "still open" : `sold ${formatExactTime(p.closedAt)}`}
                    {p.status === "closed" && p.realizedPnlUsd !== null ? ` · ${formatUsd(p.realizedPnlUsd)}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-text-3">
                  <span className="flex items-center gap-1">
                    bought by <span className="font-mono">{formatAddress(p.traderAddress, 6)}</span> <CopyButton value={p.traderAddress} label="trader address" />
                  </span>
                  <span>opened {formatExactTime(p.openedAt)}</span>
                </div>
                {p.reason && <p className="text-text-3">Why: {p.reason}</p>}
              </div>
            ))
          )}
          {total > (data?.positions.length ?? 0) && (
            <p className="text-xs text-text-3">
              Showing the newest {data!.positions.length} of {total}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
