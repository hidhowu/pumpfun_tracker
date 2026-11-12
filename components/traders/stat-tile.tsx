import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type StatTileProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "negative";
  hint?: React.ReactNode;
  /** Colours the hint (e.g. today's change next to a total). */
  hintTone?: "positive" | "negative";
};

export function StatTile({ label, value, icon: Icon, tone = "default", hint, hintTone }: StatTileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[20px] border border-border bg-card px-4 py-3.5 sm:gap-2.5 sm:px-5 sm:py-[18px]">
      <div className="flex items-center justify-between gap-2 text-xs text-text-2 sm:text-[13px]">
        <span className="truncate">{label}</span>
        <span className={cn("hidden size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-text-2 sm:inline-flex", tone === "positive" && "text-positive", tone === "negative" && "text-negative")}>
          <Icon className="size-4" />
        </span>
      </div>
      <span
        className={cn(
          "truncate text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums sm:text-2xl sm:leading-[30px]",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative"
        )}
      >
        {value}
      </span>
      {hint ? <span className={cn("flex items-start gap-1 text-xs leading-[17px] text-text-3", hintTone === "positive" && "text-positive", hintTone === "negative" && "text-negative")}>{hint}</span> : null}
    </div>
  );
}
