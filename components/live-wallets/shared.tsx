"use client";

import { ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CopyButton } from "@/components/copy-button";
import { formatAddress, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Token prices run from $100,000 down to $0.0000001, so the number of decimals follows the size. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1) return formatUsd(value);
  const decimals = Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(abs))));
  return `$${value.toFixed(decimals)}`;
}

/** Token amounts: whole numbers get separators, tiny ones keep their significant digits. */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1000) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format(value);
}

export function signedUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${formatUsd(value)}`;
}

export function signedPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function toneClass(value: number | null | undefined): string {
  if (!value) return "";
  return value > 0 ? "text-positive" : "text-negative";
}

export function toneOf(value: number | null | undefined): "default" | "positive" | "negative" {
  if (!value) return "default";
  return value > 0 ? "positive" : "negative";
}

const GRADIENTS = [
  ["#8b7cff", "#35d6b0"],
  ["#ff8a5b", "#ff4f8b"],
  ["#6d5bff", "#3b82f6"],
  ["#f5b83d", "#e8743b"],
  ["#35d6b0", "#3b82f6"],
  ["#ff4f8b", "#8b7cff"],
];

/** A stable two-colour gradient picked from any string (wallet address, token symbol), for avatars without an image. */
export function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const [from, to] = GRADIENTS[hash % GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

export function TokenAvatar({ icon, symbol, className }: { icon?: string | null; symbol?: string | null; className?: string }) {
  const label = (symbol ?? "?").slice(0, 2).toUpperCase();
  const isSol = symbol === "SOL";
  return (
    <Avatar className={cn("size-9", className)}>
      {icon ? <AvatarImage src={icon} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback
        className="text-xs font-extrabold text-white"
        style={{ background: isSol ? "linear-gradient(135deg, #9945ff, #14f195)" : gradientFor(symbol ?? "?") }}
      >
        {label}
      </AvatarFallback>
    </Avatar>
  );
}

/** A round gradient badge for a wallet, derived from its address so every wallet keeps its own colours. */
export function WalletAvatar({ address, className }: { address: string; className?: string }) {
  return <div aria-hidden className={cn("size-10 shrink-0 rounded-full", className)} style={{ background: gradientFor(address) }} />;
}

/** The small rounded label in front of a transaction: Bought / Sold / Received / Sent ... */
export function TypePill({ label, tone, className }: { label: string; tone: "buy" | "sell" | "receive" | "send" | "neutral" | "failed"; className?: string }) {
  const tones = {
    buy: "bg-positive/15 text-positive",
    sell: "bg-[#ff8a5b]/15 text-[#ff9b6e]",
    receive: "bg-primary/15 text-brand-soft",
    send: "bg-[#9a97b3]/15 text-[#b8b5d0]",
    neutral: "bg-[#9a97b3]/15 text-[#b8b5d0]",
    failed: "bg-negative/15 text-negative",
  } as const;
  return <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-extrabold whitespace-nowrap", tones[tone], className)}>{label}</span>;
}

/** Profit or loss as a tinted pill, e.g. "+$21.40 · +33.2%". */
export function PnlPill({ usd, pct, className }: { usd: number | null | undefined; pct?: number | null; className?: string }) {
  if (usd === null || usd === undefined) return null;
  const tone = usd > 0 ? "bg-positive/15 text-positive" : usd < 0 ? "bg-negative/15 text-negative" : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap tabular-nums", tone, className)}>
      {signedUsd(usd)}
      {pct !== null && pct !== undefined ? ` · ${signedPercent(pct)}` : ""}
    </span>
  );
}

export function AddressChip({ value, label = "address", kind = "account", chars = 4 }: { value: string; label?: string; kind?: "account" | "token" | "tx"; chars?: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
      <a href={`https://solscan.io/${kind}/${value}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        {formatAddress(value, chars)}
        <ExternalLink className="size-3" />
      </a>
      <CopyButton value={value} label={label} />
    </span>
  );
}

/** What to call a token: its symbol, or its shortened mint address when nothing on the internet or the chain names it. */
export function tokenLabel(symbol: string | null | undefined, mint: string): string {
  return symbol || formatAddress(mint, 4);
}

/** A small bordered box with a label and a value, used in the token and SOL panels. */
export function StatBox({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-3.5">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-[17px] font-extrabold tabular-nums", className)}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
