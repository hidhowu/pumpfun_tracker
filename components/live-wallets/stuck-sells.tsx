"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertOctagon, Loader2 } from "lucide-react";
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
    <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-negative/50 bg-negative/10 p-4">
      <div className="flex items-center gap-2 text-[15px] font-extrabold text-negative">
        <AlertOctagon className="size-5" />
        {stuck.length === 1 ? "A sell failed - this wallet still holds the position" : `${stuck.length} sells failed - this wallet still holds those positions`}
      </div>
      {stuck.map((s) => (
        <div key={s.lotId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/40 px-3 py-2 text-[13px]">
          <div className="min-w-0">
            <span className="font-mono font-bold">
              {s.mint.slice(0, 6)}…{s.mint.slice(-4)}
            </span>
            <span className="ml-2 text-muted-foreground">
              {s.reason} · gave up {formatRelativeTime(s.at)}
              {s.failures > 1 ? ` · ${s.failures} times` : ""}
            </span>
          </div>
          <Button size="sm" className="gap-1.5 bg-negative text-negative-foreground hover:bg-negative/90" disabled={busy === s.lotId} onClick={() => sell(s.lotId)}>
            {busy === s.lotId ? <Loader2 className="size-4 animate-spin" /> : null}
            Sell now
          </Button>
        </div>
      ))}
    </div>
  );
}
