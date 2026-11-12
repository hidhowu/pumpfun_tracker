"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, FlaskConical, Rocket } from "lucide-react";
import { getLinkedLive } from "@/lib/live-wallet-api";
import { formatSol, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LinkedLive } from "@/lib/live-wallet-types";

const POLL_MS = 15_000;

const tone = (n: number | null | undefined) => (n == null || n === 0 ? undefined : n > 0 ? "text-positive" : "text-negative");
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function Box({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
      <span className="truncate text-xs text-text-3">{label}</span>
      <b className={cn("text-xl font-semibold tabular-nums", className)}>{value}</b>
      {hint ? <span className="text-xs text-text-3">{hint}</span> : null}
    </div>
  );
}

/** On a simulation wallet's page: the live wallet connected to it, its balance, and how its copied trades did next to the simulated ones. Nothing if none is connected. */
export function LinkedLiveCard({ walletId }: { walletId: string }) {
  const [link, setLink] = useState<LinkedLive | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      getLinkedLive(walletId)
        .then((l) => active && setLink(l))
        .catch(() => {});
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [walletId]);

  if (!link) return null;
  const { live, balance, summary } = link;
  const settled = summary.settled;
  const real = live.tradingMode === "live";
  const diff = settled ? settled.livePnlUsd - settled.simPnlUsd : null;
  return (
    <section className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <b className="text-[13px] font-semibold">Live wallet</b>
          <Link href={`/live-wallets/${live._id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
            {live.name} <ArrowUpRight className="size-3.5" />
          </Link>
          <span
            className={cn(
              "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium",
              real ? "border-destructive/30 bg-neg-soft text-destructive" : "border-info/30 bg-info-soft text-info"
            )}
          >
            {real ? <Rocket className="size-3" /> : <FlaskConical className="size-3" />}
            {real ? "LIVE" : "Dry run"}
          </span>
        </div>
        <span className="text-xs text-text-3">
          {summary.live.open + summary.dry.open} open · {settled?.trades ?? 0} finished
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Box label="Live balance" value={balance ? formatUsd(balance.totalValueUsd) : "-"} hint={balance ? formatSol(balance.solBalance) : undefined} />
        <Box label="Live profit" value={settled ? signedUsd(settled.livePnlUsd) : "-"} className={tone(settled?.livePnlUsd)} />
        <Box label="Simulation, same trades" value={settled ? signedUsd(settled.simPnlUsd) : "-"} className={tone(settled?.simPnlUsd)} />
        <Box label="Difference" value={diff !== null ? signedUsd(diff) : "-"} className={tone(diff)} />
      </div>
    </section>
  );
}
