"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type SectionNavItem = { id: string; label: string; icon: React.ComponentType<{ className?: string }>; danger?: boolean };

/**
 * Links to the sections (cards) of a long settings page: a sticky list beside the cards on wide screens, a scrolling row of chips on phones.
 * Clicking scrolls the section into view; the active one follows the section nearest the top while scrolling.
 */
function SectionNav({ items, className }: { items: readonly SectionNavItem[]; className?: string }) {
  const [active, setActive] = React.useState<string>(items[0]?.id ?? "");

  React.useEffect(() => {
    const targets = items.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px" }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="Settings sections" className={cn("flex gap-2 overflow-x-auto max-lg:-mx-4 max-lg:px-4 lg:sticky lg:top-24 lg:flex-col lg:gap-0.5 lg:overflow-visible", className)}>
      {items.map((s) => {
        const isActive = active === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setActive(s.id);
              document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={cn(
              "flex h-10 shrink-0 items-center gap-2.5 rounded-full border px-4 text-sm whitespace-nowrap transition-colors lg:h-[38px] lg:rounded-[10px] lg:border-transparent lg:px-3",
              isActive ? "border-volt-line bg-volt-soft text-primary lg:bg-surface-3 lg:text-foreground" : "border-line-2 bg-card text-text-2 hover:text-foreground lg:bg-transparent",
              s.danger && "text-negative hover:text-negative"
            )}
          >
            <s.icon className={cn("size-4", isActive && !s.danger && "lg:text-primary")} />
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}

export { SectionNav };
