import { cn } from "@/lib/utils";

// Same six tints as the design system's avatar set; the tint follows the address so a trader always keeps its colour.
const TINTS = ["#b6f24f", "#6cd9b0", "#8fc6ff", "#d4b7ff", "#ffc98a", "#ff9fae"];

const SIZES = {
  sm: "size-7 rounded-[9px] text-[10px]",
  md: "size-9 rounded-xl text-xs",
  lg: "size-12 rounded-[15px] text-sm",
  xl: "size-16 rounded-[20px] text-lg",
} as const;

export function traderTint(address: string) {
  let h = 0;
  for (let i = 0; i < address.length; i += 1) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** A rounded square with the first two characters of the address on a tint derived from it. */
export function TraderAvatar({ address, size = "md", className }: { address: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center font-mono font-semibold text-primary-foreground", SIZES[size], className)}
      style={{ background: traderTint(address) }}
    >
      {address.slice(0, 2).toUpperCase()}
    </span>
  );
}
