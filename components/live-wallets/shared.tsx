"use client";

import { ArrowUpRight } from "lucide-react";
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
  ["#b6f24f", "#35d49a"],
  ["#6cb8ff", "#35d49a"],
  ["#f5b73d", "#ff6b7b"],
  ["#a98bff", "#6cb8ff"],
  ["#35d49a", "#6cb8ff"],
  ["#ff6b7b", "#a98bff"],
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
        className="font-mono text-[11px] font-semibold text-primary-foreground"
        style={{ background: isSol ? "linear-gradient(135deg, #9945ff, #14f195)" : gradientFor(symbol ?? "?") }}
      >
        {label}
      </AvatarFallback>
    </Avatar>
  );
}

const WALLET_AVATAR_SIZES = { md: "size-10 rounded-xl text-xs", lg: "size-12 rounded-[15px] text-sm" } as const;

/** A rounded square badge for a wallet: its initials on a gradient derived from the address, so every wallet keeps its own colours. */
export function WalletAvatar({ address, name, size = "lg", className }: { address: string; name?: string; size?: keyof typeof WALLET_AVATAR_SIZES; className?: string }) {
  const initials = (name ?? address)
    .split(/s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center font-mono font-semibold text-primary-foreground", WALLET_AVATAR_SIZES[size], className)} style={{ background: gradientFor(address) }}>
      {initials}
    </span>
  );
}

/** The small rounded label in front of a transaction: Bought / Sold / Received / Sent ... */
export function TypePill({ label, tone, className }: { label: string; tone: "buy" | "sell" | "receive" | "send" | "neutral" | "failed"; className?: string }) {
  const tones = {
    buy: "border-positive/30 bg-pos-soft text-positive",
    sell: "border-warn/30 bg-warn-soft text-warn",
    receive: "border-volt-line bg-volt-soft text-primary",
    send: "border-line-2 bg-surface-3 text-text-2",
    neutral: "border-line-2 bg-surface-3 text-text-2",
    failed: "border-destructive/30 bg-neg-soft text-destructive",
  } as const;
  return <span className={cn("inline-flex h-[22px] w-fit items-center rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap", tones[tone], className)}>{label}</span>;
}

/** Profit or loss as a tinted pill, e.g. "+$21.40 · +33.2%". */
export function PnlPill({ usd, pct, className }: { usd: number | null | undefined; pct?: number | null; className?: string }) {
  if (usd === null || usd === undefined) return null;
  const tone = usd > 0 ? "border-positive/30 bg-pos-soft text-positive" : usd < 0 ? "border-destructive/30 bg-neg-soft text-destructive" : "border-line-2 bg-surface-3 text-text-2";
  return (
    <span className={cn("inline-flex h-[22px] w-fit items-center rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap tabular-nums", tone, className)}>
      {signedUsd(usd)}
      {pct !== null && pct !== undefined ? ` · ${signedPercent(pct)}` : ""}
    </span>
  );
}

/** A short address as a chip: it links to Solscan and has its own copy button. */
export function AddressChip({ value, label = "address", kind = "account", chars = 4 }: { value: string; label?: string; kind?: "account" | "token" | "tx"; chars?: number }) {
  return (
    <span className="inline-flex h-[26px] w-fit items-center gap-1 rounded-lg border border-border bg-surface-2 pr-1 pl-2 font-mono text-xs text-text-2 transition-colors hover:border-line-2 hover:text-foreground">
      <a href={`https://solscan.io/${kind}/${value}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
        {formatAddress(value, chars)}
        <ArrowUpRight className="size-3" />
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
    <div className="min-w-0 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
      <div className="text-xs text-text-3">{label}</div>
      <div className={cn("mt-1 truncate text-[18px] leading-6 font-semibold tabular-nums", className)}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-xs text-text-3">{hint}</div> : null}
    </div>
  );
}
