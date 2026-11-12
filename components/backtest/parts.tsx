import * as React from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { cn } from "@/lib/utils";

/** Recharts styling that matches the rest of the app. */
export const axisTick = { fill: "var(--text-3)", fontSize: 11 };
export const gridStroke = "var(--line)";
export const axisLineStroke = "var(--line-2)";
export const tooltipClass = "rounded-xl border border-line-2 bg-popover px-3 py-2.5 text-xs shadow-[0_12px_32px_rgba(0,0,0,0.5)]";

/**
 * A card with a header (title, an optional one-line help tip, something on the right) and a body. Mirrors the design's "card / card-h / card-p".
 * `flush` removes the body padding (for a table that should run edge to edge).
 */
export function Panel({
  title,
  icon,
  help,
  aside,
  flush,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  help?: React.ReactNode;
  aside?: React.ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-border bg-card", className)}>
      {title || aside ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3.5 md:px-5 md:py-4">
          <b className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            {icon}
            {title}
            {help ? <HelpTip className="ml-0">{help}</HelpTip> : null}
          </b>
          {aside ? <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-3">{aside}</div> : null}
        </div>
      ) : null}
      <div className={cn(flush ? "" : "flex flex-col gap-4 p-4 md:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A small framed figure: label, a big number and one line under it. */
export function Mini({ label, value, hint, tone, className }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tone?: "pos" | "neg"; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-2 px-3.5 py-3", className)}>
      <span className="text-xs text-text-3">{label}</span>
      <b className={cn("text-[22px] leading-7 font-semibold tracking-[-0.02em] tabular-nums", tone === "neg" && "text-negative", tone === "pos" && "text-positive")}>{value}</b>
      {hint ? <span className="text-xs leading-[17px] text-text-3">{hint}</span> : null}
    </div>
  );
}

/** A label/value pair used in KPI rows. */
export function Kpi({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-text-3">{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

/** The inset note under a chart or table: a single quiet line. */
export function Note({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-[18px] text-text-3", className)}>{children}</p>;
}

/** The empty state of a panel: an icon in a rounded square and one line. */
export function EmptyNote({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[140px] flex-col items-center justify-center gap-2.5 px-4 py-8 text-center">
      {icon ? <span className="flex size-[44px] items-center justify-center rounded-2xl bg-surface-3 text-primary">{icon}</span> : null}
      <span className="max-w-[420px] text-sm text-text-2">{children}</span>
    </div>
  );
}
