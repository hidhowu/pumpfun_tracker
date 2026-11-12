"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pause, Play, RefreshCw, ScrollText, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DialogIcon } from "@/components/ui/dialog-parts";
import { HelpTip } from "@/components/ui/help-tip";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyBox } from "@/components/rpc/parts";
import { getLogs, reconnectRpc } from "@/lib/api";
import type { SystemLogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type CategoryTab = "rpc" | "tracker" | "trade";
type LevelFilter = "all" | "warn" | "error";

const TABS: { value: CategoryTab; label: string; hint: string }[] = [
  { value: "rpc", label: "RPC", hint: "Connection health - connects, disconnects, reconnects, errors" },
  { value: "tracker", label: "Tracking", hint: "Per-address watch/unwatch status and parse/persist failures" },
  { value: "trade", label: "Trades", hint: "Simulated buys/sells: filled, closed, or skipped and why" },
];

const LEVELS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "warn", label: "Warnings" },
  { value: "error", label: "Errors" },
];

const LEVEL_STYLES: Record<SystemLogEntry["level"], string> = {
  info: "text-text-2",
  warn: "text-warn",
  error: "text-destructive",
};

const LEVEL_NAME: Record<SystemLogEntry["level"], string> = { info: "Info", warn: "Warning", error: "Error" };

const LOG_LIMIT = 150;

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
}

export default function LogsPage() {
  const [category, setCategory] = useState<CategoryTab>("rpc");
  const [logs, setLogs] = useState<SystemLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async (cat: CategoryTab, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { logs } = await getLogs(cat, LOG_LIMIT);
      setLogs(logs);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : "Failed to load logs");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh(category);
    if (paused) return;
    const interval = setInterval(() => refresh(category, { silent: true }), 5000);
    return () => clearInterval(interval);
  }, [category, refresh, paused]);

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

  function changeCategory(next: CategoryTab) {
    setCategory(next);
    setLogs(null); // the list on screen belongs to the other tab - show the skeleton until this one loads
  }

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => (logs ?? []).filter((l) => (level === "all" || l.level === level) && (!needle || l.message.toLowerCase().includes(needle))),
    [logs, level, needle]
  );
  const filtered = level !== "all" || needle !== "";
  const hint = TABS.find((t) => t.value === category)?.hint;

  const reconnect = (
    <Button variant="outline" size="sm" onClick={handleReconnect} disabled={reconnecting} className="gap-1.5 max-md:h-11 max-md:w-full max-md:text-[13px]">
      <RefreshCw className={cn("size-3.5", reconnecting && "animate-spin")} />
      Reconnect RPC
    </Button>
  );

  const search = (
    <label className="flex h-11 min-w-0 items-center gap-2 rounded-[14px] border border-line-2 bg-card px-3 text-text-3 transition-colors focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50 hover:border-line-3 md:h-9 md:w-[300px] md:rounded-[10px]">
      <Search className="size-4 shrink-0" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search messages"
        aria-label="Search messages"
        className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-[13px]"
      />
      {query ? (
        <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-surface-3 hover:text-foreground">
          <X className="size-3.5" />
        </button>
      ) : null}
    </label>
  );

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DialogIcon>
            <ScrollText className="size-5" />
          </DialogIcon>
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px] md:tracking-[-0.025em]">
            Logs
            <HelpTip>Live tracker activity - no need to check the terminal or PM2. Entries older than 2 days are cleaned up automatically.</HelpTip>
          </h1>
        </div>
        <div className="flex items-center gap-2 max-md:hidden">
          {category === "rpc" && reconnect}
          <Segmented label="Log category" options={TABS} value={category} onChange={changeCategory} />
        </div>
      </div>

      {/* Phone: the category switch is full width, Reconnect under it */}
      <div className="flex flex-col gap-3 md:hidden">
        <Segmented label="Log category" options={TABS} value={category} onChange={changeCategory} block tall />
        {category === "rpc" && reconnect}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Level" options={LEVELS} value={level} onChange={setLevel} className="max-md:hidden" />
        <div className="flex gap-2 overflow-x-auto md:hidden" role="group" aria-label="Level">
          {LEVELS.map((l) => (
            <Chip key={l.value} active={level === l.value} onClick={() => setLevel(l.value)}>
              {l.label}
            </Chip>
          ))}
        </div>
        <div className="max-md:w-full">{search}</div>
        <div className="hidden flex-1 md:block" />
        <Button variant="ghost" size="sm" className="gap-1.5 max-md:hidden" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "Resume updates" : "Pause updates"}
        </Button>
        <span className="text-xs text-text-3 max-md:w-full">
          {paused ? "Paused" : "Refreshes every 5 s"} · newest first · {LOG_LIMIT} shown
          {hint ? <HelpTip>{hint}</HelpTip> : null}
        </span>
        <Button variant="outline" className="h-11 w-full gap-1.5 text-[13px] md:hidden" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "Resume updates" : "Pause updates"}
        </Button>
      </div>

      {loading && !logs ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg" />
          ))}
        </div>
      ) : !logs || logs.length === 0 ? (
        <EmptyBox icon={<ScrollText className="size-6" />} title={`No ${category} activity in the last 2 days.`} className="min-h-[240px]" />
      ) : visible.length === 0 ? (
        <EmptyBox title="No entries match this filter." className="min-h-[160px]">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLevel("all");
              setQuery("");
            }}
          >
            Clear filter
          </Button>
        </EmptyBox>
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-border bg-card">
          {filtered ? (
            <div className="border-b border-border px-4 py-2 text-xs text-text-3 tabular-nums">
              {visible.length} of {logs.length} entries
            </div>
          ) : null}
          <ul className="divide-y divide-border">
            {visible.map((log) => (
              <li key={log._id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="w-[68px] shrink-0 pt-px font-mono text-xs text-text-3 tabular-nums">{formatTimestamp(log.createdAt)}</span>
                <span className={cn("min-w-0 flex-1 text-sm leading-5 break-words", LEVEL_STYLES[log.level])}>
                  <span className="sr-only">{LEVEL_NAME[log.level]}: </span>
                  {log.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
