"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getBacktestSettings } from "@/lib/backtest-api";
import { copyText } from "@/lib/clipboard";

const STALE_AFTER_MS = 20_000;
const PM2_COMMAND = "pm2 start ecosystem.config.cjs --only pumpfun-tracker-backtest";

/**
 * The backtest worker is its own process (pm2: pumpfun-tracker-backtest).
 * If it isn't running, backtests would sit "queued" with no explanation - so
 * say so. Renders nothing while the worker's heartbeat is fresh.
 */
export function WorkerStatus({ showOnline = false, detail }: { /** Also show a green "Worker online" line while the heartbeat is fresh (the run page does). */ showOnline?: boolean; /** What it is working on, e.g. "working on this backtest". */ detail?: string }) {
  const [state, setState] = useState<"unknown" | "running" | "stopped">("unknown");
  const [worker, setWorker] = useState<{ id: string | null; heartbeatAt: string | null } | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { worker } = await getBacktestSettings();
        if (!cancelled) setWorker(worker);
        const fresh = worker.heartbeatAt != null && Date.now() - new Date(worker.heartbeatAt).getTime() < STALE_AFTER_MS;
        if (!cancelled) setState(fresh ? "running" : "stopped");
      } catch {
        // transient - keep whatever we last knew
      }
    };
    check();
    const interval = setInterval(check, 8000);
    const clock = setInterval(() => tick((n) => n + 1), 1000); // keeps "heartbeat 3 s ago" ticking between checks
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(clock);
    };
  }, []);

  if (state === "running" && showOnline) {
    const ago = worker?.heartbeatAt ? Math.max(0, Math.round((Date.now() - new Date(worker.heartbeatAt).getTime()) / 1000)) : null;
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] border border-positive/30 bg-pos-soft px-3.5 py-3 text-[13px] text-text-2">
        <span className="size-2 shrink-0 rounded-full bg-positive" />
        <span className="min-w-0 flex-1">
          <b className="text-foreground">Worker online</b>
          {detail ? ` · ${detail}` : ""}
        </span>
        {ago !== null ? (
          <span className="font-mono text-xs text-text-3">
            {worker?.id ? `${worker.id} · ` : ""}heartbeat {ago} s ago
          </span>
        ) : null}
      </div>
    );
  }

  if (state !== "stopped") return null;

  async function copy() {
    if (await copyText(PM2_COMMAND)) toast.success("Command copied");
    else toast.error("Could not copy the command");
  }

  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-[14px] border border-warn/30 bg-warn-soft p-3.5 text-[13px] text-[#f0dcae]">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <b className="text-foreground">The backtest worker isn&apos;t running</b>
        <span className="text-text-2 max-md:hidden">
          Backtests are processed by a separate process, so nothing will progress until it is started. This banner disappears by itself once the worker&apos;s heartbeat is fresh.
        </span>
        <span className="text-xs text-text-2 md:hidden">Nothing will progress until it is started.</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg border border-border bg-surface-2 px-2 py-1 font-mono text-xs break-all text-foreground max-md:hidden">{PM2_COMMAND}</code>
          <span className="text-xs text-text-3 max-md:hidden">or</span>
          <code className="rounded-lg border border-border bg-surface-2 px-2 py-1 font-mono text-xs text-foreground">npm run backtest</code>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void copy()} className="max-md:hidden">
        Copy command
      </Button>
    </div>
  );
}
