import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatTileProps = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "negative";
  hint?: string;
};

export function StatTile({ label, value, icon: Icon, tone = "default", hint }: StatTileProps) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
          <span
            className={cn(
              "truncate text-2xl font-extrabold tracking-tight tabular-nums",
              tone === "positive" && "text-positive",
              tone === "negative" && "text-negative"
            )}
          >
            {value}
          </span>
          {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-brand-soft">
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}
