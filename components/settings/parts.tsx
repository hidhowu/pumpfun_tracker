import * as React from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { cn } from "@/lib/utils";

/** A card of one settings section: an icon box and title (with an optional one-line subtitle / help tip) and, on the right, a tag such as the scope. */
export function Section({
  id,
  icon: Icon,
  title,
  subtitle,
  help,
  scope,
  tone = "default",
  children,
}: {
  id?: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  help?: string;
  scope?: React.ReactNode;
  tone?: "default" | "info" | "danger";
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 overflow-hidden rounded-[20px] border bg-card", tone === "danger" ? "border-destructive/35" : "border-border")}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5 md:py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-3", tone === "info" ? "text-info" : tone === "danger" ? "bg-neg-soft text-negative" : "text-primary")}>
            <Icon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col">
            <h2 className={cn("text-[15px] leading-tight font-semibold", tone === "danger" && "text-negative")}>
              {title}
              {help ? <HelpTip>{help}</HelpTip> : null}
            </h2>
            {subtitle ? <span className="text-xs text-text-3">{subtitle}</span> : null}
          </div>
        </div>
        {scope}
      </div>
      <div className="flex flex-col gap-4 p-4 md:p-5">{children}</div>
    </section>
  );
}

export /** A switch with a title and one status line, in its own rounded box (stop-loss, take-profit, kill switch...). */
function ToggleRow({ title, status, statusTone, danger, children }: { title: React.ReactNode; status?: React.ReactNode; statusTone?: "negative"; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-h-[52px] items-center justify-between gap-4 rounded-[14px] border px-3.5 py-3", danger ? "border-destructive/40 bg-neg-soft" : "border-border bg-surface-2")}>
      <div className="flex min-w-0 flex-col">
        <b className="text-[13px] font-semibold">{title}</b>
        {status ? <span className={cn("text-xs", statusTone === "negative" ? "font-medium text-negative" : "text-text-3")}>{status}</span> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
