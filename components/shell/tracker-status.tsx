"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getBacktestSettings } from "@/lib/backtest-api";
import { listHttpRpcEndpoints, listProxies, listRpcEndpoints, reconnectRpc } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The backtest worker is "running" while its heartbeat is this fresh (same rule as the worker banner on /backtest). */
const WORKER_STALE_AFTER_MS = 60_000;
const POLL_MS = 15_000;

type Tone = "pos" | "warn" | "neg" | "volt" | "none";

export type TrackerStatus = {
  loaded: boolean;
  updatedAt: number | null;
  /** WebSocket RPC endpoints: connected of all configured; `usable` = enabled and not blacklisted. */
  ws: { connected: number; usable: number; total: number } | null;
  http: { active: number; total: number } | null;
  proxies: { active: number; total: number } | null;
  worker: { running: boolean } | null;
  /** The overall word for the top bar pill. */
  overall: { tone: Tone; label: string };
  traderCount: number | null;
};

const EMPTY: TrackerStatus = { loaded: false, updatedAt: null, ws: null, http: null, proxies: null, worker: null, overall: { tone: "none", label: "Tracker" }, traderCount: null };

const StatusContext = createContext<TrackerStatus>(EMPTY);
export const useTrackerStatus = () => useContext(StatusContext);

/**
 * One poll for everything the shell shows about the system: RPC and proxy health, the backtest worker, the number of tracked traders.
 * It only reads what the RPC, Proxies and Backtest pages already read - no new tracking logic.
 */
export function TrackerStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TrackerStatus>(EMPTY);

  const refresh = useCallback(async () => {
    const [ws, http, proxies, backtest, count] = await Promise.all([
      listRpcEndpoints().catch(() => null),
      listHttpRpcEndpoints().catch(() => null),
      listProxies().catch(() => null),
      getBacktestSettings().catch(() => null),
      fetch("/api/traders/count")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    const usable = (e: { enabled: boolean; health?: string }) => e.enabled && e.health !== "blacklisted";
    const wsStat = ws ? { connected: ws.endpoints.filter((e) => usable(e) && e.status === "connected").length, usable: ws.endpoints.filter(usable).length, total: ws.endpoints.length } : null;
    const httpStat = http ? { active: http.endpoints.filter(usable).length, total: http.endpoints.length } : null;
    const proxyStat = proxies ? { active: proxies.proxies.filter((p) => p.enabled && p.status === "active").length, total: proxies.proxies.length } : null;
    const heartbeat = backtest?.worker.heartbeatAt;
    const workerStat = backtest ? { running: !!heartbeat && Date.now() - new Date(heartbeat).getTime() < WORKER_STALE_AFTER_MS } : null;

    let overall: TrackerStatus["overall"] = { tone: "none", label: "Tracker" };
    if (wsStat) {
      if (wsStat.total === 0) overall = { tone: "none", label: "No RPC" };
      else if (wsStat.connected === wsStat.usable && wsStat.usable > 0) overall = { tone: "pos", label: "Tracker live" };
      else if (wsStat.connected > 0) overall = { tone: "warn", label: "Tracker degraded" };
      else overall = { tone: "neg", label: "Tracker offline" };
    }
    setStatus({ loaded: true, updatedAt: Date.now(), ws: wsStat, http: httpStat, proxies: proxyStat, worker: workerStat, overall, traderCount: count?.count ?? null });
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [refresh]);

  return <StatusContext.Provider value={status}>{children}</StatusContext.Provider>;
}

const DOT: Record<Tone, string> = {
  pos: "bg-positive",
  warn: "bg-warn",
  neg: "bg-destructive",
  volt: "bg-primary",
  none: "bg-text-3",
};

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone], className)} />;
}

function ratioTone(ok: number, total: number): Tone {
  if (total === 0) return "none";
  return ok === total ? "pos" : ok === 0 ? "neg" : "warn";
}

function Row({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <div className="flex min-h-9 items-center gap-2.5 px-2">
      <StatusDot tone={tone} />
      <span className="grow text-[13px]">{label}</span>
      <span className={cn("font-mono text-xs tabular-nums", tone === "warn" ? "text-warn" : tone === "neg" ? "text-destructive" : "text-text-2")}>{value}</span>
    </div>
  );
}

/** "Tracker live · 4/4 RPC" in the top bar; opens the health breakdown with shortcuts to Logs and a reconnect. */
export function TrackerHealth() {
  const s = useTrackerStatus();
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ago = useMemo(() => (s.updatedAt ? Math.max(0, Math.round((now - s.updatedAt) / 1000)) : null), [now, s.updatedAt]);

  async function reconnect() {
    setReconnecting(true);
    try {
      await reconnectRpc();
      toast.success("Reconnect requested - the tracker daemon picks this up within ~5s");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to request reconnect");
    } finally {
      setReconnecting(false);
    }
  }

  const rpcNote = s.ws && s.ws.total > 0 ? `${s.ws.connected}/${s.ws.usable} RPC` : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${s.overall.label}${rpcNote ? `, ${rpcNote}` : ""}. Open system health`}
          className="hidden h-9 items-center gap-2 rounded-full border border-line-2 bg-card px-3 text-[13px] whitespace-nowrap transition-colors hover:border-line-3 hover:bg-surface-2 md:inline-flex"
        >
          {s.loaded ? <StatusDot tone={s.overall.tone} /> : <Loader2 className="size-3.5 animate-spin text-text-3" />}
          <span className="hidden xl:inline">{s.overall.label}</span>
          <Activity className="size-4 text-text-2 xl:hidden" />
          {rpcNote ? <span className="text-text-3">· {rpcNote}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
          <b className="flex items-center gap-2 text-sm font-semibold">
            <StatusDot tone={s.overall.tone} />
            {s.overall.label}
          </b>
          <span className="text-xs text-text-3 tabular-nums">{ago === null ? "loading…" : `updated ${ago} s ago`}</span>
        </div>
        <div className="flex flex-col px-1.5 py-1.5">
          <Row tone={s.ws ? ratioTone(s.ws.connected, s.ws.usable) : "none"} label="WebSocket" value={s.ws ? `${s.ws.connected} / ${s.ws.total}` : "—"} />
          <Row tone={s.http ? ratioTone(s.http.active, s.http.total) : "none"} label="HTTP RPC" value={s.http ? `${s.http.active} / ${s.http.total}` : "—"} />
          <Row tone={s.proxies ? ratioTone(s.proxies.active, s.proxies.total) : "none"} label="Proxies" value={s.proxies ? `${s.proxies.active} / ${s.proxies.total}` : "—"} />
          <Row tone={s.worker ? (s.worker.running ? "volt" : "warn") : "none"} label="Backtest worker" value={s.worker ? (s.worker.running ? "running" : "not running") : "—"} />
        </div>
        <div className="flex gap-2 border-t border-border px-3 py-2.5">
          <Button asChild variant="outline" size="sm" className="flex-1">
            <Link href="/logs">Open logs</Link>
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={reconnect} disabled={reconnecting}>
            {reconnecting ? <Loader2 className="animate-spin" /> : null}
            Reconnect RPC
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
