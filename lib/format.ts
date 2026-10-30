const solFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 0 });
const usdFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
const tokenFormatter = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

export function formatSol(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${solFormatter.format(value)} SOL`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return usdFormatter.format(value);
}

export function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return compactUsdFormatter.format(value);
}

export function formatTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return tokenFormatter.format(value);
}

export function formatAddress(address: string, chars = 4): string {
  if (!address || address.length <= chars * 2 + 1) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

/** The exact moment, to the second, in UTC (the same clock the backtest and the logs use): "Oct 31, 14:05:09". */
export function formatExactTime(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" });
}

/** "12s", "4m 05s", "2h 10m": how long something lasted. */
export function formatHeld(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatRelativeTime(input: string | number | Date | null | undefined): string {
  if (!input) return "never";
  const date = new Date(input);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function winRate(wins: number, losses: number): number | null {
  const total = wins + losses;
  if (total === 0) return null;
  return (wins / total) * 100;
}
