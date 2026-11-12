"use client";

import * as React from "react";
import { Check, ChevronDown, Info, TriangleAlert } from "lucide-react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpTip } from "@/components/ui/help-tip";
import { Label } from "@/components/ui/label";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** The round icon at the head of a dialog (the design's "dlg-ic"). */
export function DialogIcon({ children }: { children: React.ReactNode }) {
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-primary">{children}</span>;
}

/** Icon, title with its one-line help, and a description that screen readers get but the eye does not need. */
export function DialogHead({ icon, title, help, description }: { icon: React.ReactNode; title: React.ReactNode; help?: React.ReactNode; description?: string }) {
  return (
    <DialogHeader className="flex-row items-center gap-3">
      <DialogIcon>{icon}</DialogIcon>
      <DialogTitle>
        {title}
        {help ? <HelpTip tabIndex={-1}>{help}</HelpTip> : null}
      </DialogTitle>
      <DialogDescription className="sr-only">{description ?? (typeof title === "string" ? title : "")}</DialogDescription>
    </DialogHeader>
  );
}

/** A labelled control: label (with an optional one-line help and "(optional)"), the control, then a quiet line under it. */
export function Field({
  label,
  help,
  htmlFor,
  optional,
  note,
  className,
  children,
}: {
  label: React.ReactNode;
  help?: React.ReactNode;
  htmlFor?: string;
  optional?: boolean;
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ml-1 font-normal text-text-3">(optional)</span> : null}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </Label>
      {children}
      {note ? <p className="text-xs leading-[18px] text-text-3">{note}</p> : null}
    </div>
  );
}

/** A check box that is only drawn (for rows that are themselves one button, where a real checkbox would nest a button in a button). */
export function CheckMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px]", checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card", className)}
    >
      {checked ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

/** A framed group inside a dialog ("Timing", "Speed and loss traders"…): a title, an optional note, then its rows. */
export function Inset({ title, note, help, children, className }: { title: React.ReactNode; note?: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4", className)}>
      <div className="flex flex-col gap-0.5">
        <b className="text-sm font-semibold">
          {title}
          {help ? <HelpTip>{help}</HelpTip> : null}
        </b>
        {note ? <span className="text-xs text-text-3">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * An `Inset` on wide screens; on a phone it folds to one line (title + a summary of its values) until opened, so the sheet
 * shows the essentials first and the rest one tap away.
 */
export function Group({ title, summary, note, help, children }: { title: React.ReactNode; summary?: React.ReactNode; note?: React.ReactNode; help?: React.ReactNode; children: React.ReactNode }) {
  const phone = !useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = React.useState(false);
  if (!phone) {
    return (
      <Inset title={title} note={note} help={help}>
        {children}
      </Inset>
    );
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left">
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-sm font-semibold">{title}</b>
          {summary ? <span className="text-xs text-text-3">{summary}</span> : null}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border p-4">
          {note ? <span className="text-xs text-text-3">{note}</span> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A one-line callout: warn (amber), info (blue) or neg (red). */
export function Notice({ tone = "warn", children, className }: { tone?: "warn" | "info" | "neg"; children: React.ReactNode; className?: string }) {
  const Icon = tone === "info" ? Info : TriangleAlert;
  return (
    <div
      role={tone === "neg" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] leading-5",
        tone === "warn" && "border-warn/30 bg-warn-soft text-warn",
        tone === "info" && "border-info/30 bg-info-soft text-text-2",
        tone === "neg" && "border-destructive/30 bg-neg-soft text-[#ffc9d0]",
        className
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "info" && "text-info", tone === "neg" && "text-destructive")} />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
