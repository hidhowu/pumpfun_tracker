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
    <Card className="border-border/70 bg-card/60">
      <CardContent className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span
            className={cn(
              "font-mono text-xl font-semibold tracking-tight",
              tone === "positive" && "text-positive",
              tone === "negative" && "text-negative"
            )}
          >
            {value}
          </span>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </div>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4.5" />
        </div>
      </CardContent>
    </Card>
  );
}
