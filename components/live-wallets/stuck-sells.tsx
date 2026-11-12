"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradingState, sellLotNow } from "@/lib/live-wallet-api";
import { formatRelativeTime } from "@/lib/format";
import type { StuckSell } from "@/lib/live-wallet-types";

const POLL_MS = 15_000;

/**
 * A red banner for open positions whose sell gave up after all its retries: the tokens are still in the wallet. "Sell now" queues the sell again
 * (the same route and retries); the alternative is to sell the token by hand from the wallet's own key.
 */
export function StuckSellsBanner({ walletId, refreshKey = 0 }: { walletId: string; refreshKey?: number }) {
  const [stuck, setStuck] = useState<StuckSell[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStuck((await getTradingState(walletId)).stuckSells);
    } catch {
      // the banner just stays as it was
    }
  }, [walletId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  async function sell(lotId: string) {
    setBusy(lotId);
    try {
      await sellLotNow(walletId, lotId);
      toast.success("Sell queued - it is retried like any other sell");
      setTimeout(load, 2500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't queue the sell");
    } finally {
      setBusy(null);
    }
  }

  if (stuck.length === 0) return null;
  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-2xl border border-destructive/30 bg-neg-soft p-3.5 md:p-4">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-destructive">
        <TriangleAlert className="size-[18px] shrink-0" />
        {stuck.length === 1 ? "A sell failed — this wallet still holds the position" : `${stuck.length} sells failed — this wallet still holds those positions`}
      </div>
      {stuck.map((s) => (
        <div key={s.lotId} className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5">
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-[13px] font-semibold">
              {s.mint.slice(0, 4)}…{s.mint.slice(-5)}
            </span>
            <span className="text-xs text-text-2">
              {s.reason} · gave up {formatRelativeTime(s.at)}
              {s.failures > 1 ? ` · ${s.failures} times` : ""}
            </span>
          </div>
          <Button size="sm" className="gap-1.5 bg-negative font-semibold text-negative-foreground hover:bg-negative/90 max-md:h-10" disabled={busy === s.lotId} onClick={() => sell(s.lotId)}>
            {busy === s.lotId ? <Loader2 className="animate-spin" /> : null}
            Sell now
          </Button>
        </div>
      ))}
    </div>
  );
}
