"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Rocket, TestTube2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatBox, signedUsd, toneClass } from "@/components/live-wallets/shared";
import { getLinkedLive } from "@/lib/live-wallet-api";
import { formatSol, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LinkedLive } from "@/lib/live-wallet-types";

const POLL_MS = 15_000;

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
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-extrabold">Live wallet</span>
          <Link href={`/live-wallets/${live._id}`} className="inline-flex items-center gap-1 text-sm font-extrabold text-brand-soft hover:underline">
            {live.name} <ArrowUpRight className="size-3.5" />
          </Link>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold", real ? "bg-negative/15 text-negative" : "bg-primary/15 text-brand-soft")}>
            {real ? <Rocket className="size-3" /> : <TestTube2 className="size-3" />}
            {real ? "LIVE" : "Dry run"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{summary.live.open + summary.dry.open} open · {(settled?.trades ?? 0)} finished</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatBox label="Live balance" value={balance ? formatUsd(balance.totalValueUsd) : "-"} hint={balance ? formatSol(balance.solBalance) : undefined} />
        <StatBox label="Live profit" value={settled ? signedUsd(settled.livePnlUsd) : "-"} className={toneClass(settled?.livePnlUsd)} />
        <StatBox label="Simulation, same trades" value={settled ? signedUsd(settled.simPnlUsd) : "-"} className={toneClass(settled?.simPnlUsd)} />
        <StatBox label="Difference" value={settled ? signedUsd(settled.livePnlUsd - settled.simPnlUsd) : "-"} className={toneClass(settled ? settled.livePnlUsd - settled.simPnlUsd : 0)} />
      </div>
    </Card>
  );
}
