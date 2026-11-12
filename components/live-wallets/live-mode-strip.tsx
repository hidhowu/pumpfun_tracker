"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pause, Play, Undo2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTradingState, updateTrading } from "@/lib/live-wallet-api";

const POLL_MS = 10_000;

/**
 * A strip above the tabs while the wallet is trading for real, with the quickest ways to stop new trades or go back to a dry run. It only reads the
 * trading state and sends the same two changes the Trading tab already offers (pause, back to dry run - neither needs a code).
 */
export function LiveModeStrip({ walletId, refreshKey = 0, onChanged }: { walletId: string; refreshKey?: number; onChanged?: () => void }) {
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);

  // State is set in the promise callback (not synchronously), so calling this from an effect is fine.
  const load = useCallback(
    () =>
      getTradingState(walletId)
        .then((s) => {
          setLive(s.connected && s.tradingMode === "live");
          setPaused(s.paused);
        })
        .catch(() => {
          // the strip just stays as it was
        }),
    [walletId]
  );

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  async function apply(patch: Parameters<typeof updateTrading>[1], success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await updateTrading(walletId, patch);
      toast.success(success);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the settings");
    } finally {
      setBusy(false);
    }
  }

  if (!live) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 bg-neg-soft px-3.5 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-[#ffc9d0]">
        <Zap className="size-4 shrink-0 text-destructive" />
        LIVE — real transactions are being sent{paused ? " (new trades paused)" : ""}
      </span>
      <span className="flex-1" />
      <div className="flex items-center gap-2 max-md:w-full">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 max-md:h-10 max-md:flex-1"
          disabled={busy}
          onClick={() => apply({ paused: !paused }, paused ? "Resumed - new trades are taken again" : "Paused - no new trades. Open positions are still sold when they exit.")}
        >
          {paused ? <Play /> : <Pause />}
          {paused ? "Resume trading" : "Pause new trades"}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5 max-md:h-10 max-md:flex-1" disabled={busy} onClick={() => apply({ tradingMode: "dry" }, "Back to a dry run - new trades are not sent. Positions already open are still sold for real when they exit.")}>
          <Undo2 /> Back to dry run
        </Button>
      </div>
    </div>
  );
}
