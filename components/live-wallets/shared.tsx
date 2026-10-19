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

export function TokenAvatar({ icon, symbol, className }: { icon?: string | null; symbol?: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-8", className)}>
      {icon ? <AvatarImage src={icon} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{(symbol ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
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
