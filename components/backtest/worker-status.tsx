"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { getBacktestSettings } from "@/lib/backtest-api";

const STALE_AFTER_MS = 20_000;

/**
 * The backtest worker is its own process (pm2: pumpfun-tracker-backtest).
 * If it isn't running, backtests would sit "queued" with no explanation - so
 * say so. Renders nothing while the worker's heartbeat is fresh.
 */
export function WorkerStatus() {
  const [state, setState] = useState<"unknown" | "running" | "stopped">("unknown");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const { worker } = await getBacktestSettings();
        const fresh = worker.heartbeatAt != null && Date.now() - new Date(worker.heartbeatAt).getTime() < STALE_AFTER_MS;
        if (!cancelled) setState(fresh ? "running" : "stopped");
      } catch {
        // transient - keep whatever we last knew
      }
    };
    check();
    const interval = setInterval(check, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (state !== "stopped") return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <div className="min-w-0">
        <p className="font-medium text-amber-500">The backtest worker isn&apos;t running</p>
        <p className="text-muted-foreground">
          Backtests are processed by a separate process, so nothing will progress until it is started:{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs break-all">pm2 start ecosystem.config.cjs --only pumpfun-tracker-backtest</code> (or{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm run backtest</code> in a terminal).
        </p>
      </div>
    </div>
  );
}
