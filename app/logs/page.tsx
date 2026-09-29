"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, AlertTriangle, Info, RefreshCw, ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLogs, reconnectRpc } from "@/lib/api";
import type { SystemLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type CategoryTab = "rpc" | "tracker" | "trade";

const TABS: { value: CategoryTab; label: string; hint: string }[] = [
  { value: "rpc", label: "RPC", hint: "Connection health - connects, disconnects, reconnects, errors" },
  { value: "tracker", label: "Tracking", hint: "Per-address watch/unwatch status and parse/persist failures" },
  { value: "trade", label: "Trades", hint: "Simulated buys/sells: filled, closed, or skipped and why" },
];

const LEVEL_STYLES: Record<SystemLogEntry["level"], string> = {
  info: "text-muted-foreground",
  warn: "text-amber-400",
  error: "text-negative",
};

function LevelIcon({ level }: { level: SystemLogEntry["level"] }) {
  if (level === "error") return <AlertCircle className="size-3.5 shrink-0 text-negative" />;
  if (level === "warn") return <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />;
  return <Info className="size-3.5 shrink-0 text-muted-foreground" />;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
}

export default function LogsPage() {
  const [category, setCategory] = useState<CategoryTab>("rpc");
  const [logs, setLogs] = useState<SystemLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

  const refresh = useCallback(async (cat: CategoryTab, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { logs } = await getLogs(cat, 150);
      setLogs(logs);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(category);
    const interval = setInterval(() => refresh(category, { silent: true }), 5000);
    return () => clearInterval(interval);
  }, [category, refresh]);

  async function handleReconnect() {
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ScrollText className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Logs</h1>
            <p className="text-sm text-muted-foreground">
              Live tracker activity - no need to check the terminal or PM2. Entries older than 24h are cleaned up automatically.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {category === "rpc" && (
            <Button variant="outline" size="sm" onClick={handleReconnect} disabled={reconnecting} className="gap-1.5">
              <RefreshCw className={cn("size-3.5", reconnecting && "animate-spin")} />
              Reconnect RPC
            </Button>
          )}
          <Tabs value={category} onValueChange={(v) => setCategory(v as CategoryTab)}>
            <TabsList>
              {TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{TABS.find((t) => t.value === category)?.hint}</p>

      {loading && !logs ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      ) : !logs || logs.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-center">
          <p className="text-sm text-muted-foreground">No {category} activity in the last 24 hours.</p>
        </div>
      ) : (
        <Card className="border-border/60">
          <CardContent className="flex flex-col divide-y divide-border/40 p-0">
            {logs.map((log) => (
              <div key={log._id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <LevelIcon level={log.level} />
                <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{formatTimestamp(log.createdAt)}</span>
                <span className={cn("flex-1", LEVEL_STYLES[log.level])}>{log.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
