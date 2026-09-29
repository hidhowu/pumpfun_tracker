"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TrailingStop } from "@/lib/types";

type Props = {
  value: TrailingStop[];
  onChange: (next: TrailingStop[]) => void;
  disabled?: boolean;
};

let tempIdCounter = 0;
function tempId() {
  tempIdCounter += 1;
  return `new-${Date.now()}-${tempIdCounter}`;
}

/**
 * Editable list of independent trailing-stop rules ({armPercent, exitPercent}
 * pairs) - see db/simulation/executor.js's checkRiskExits for how they're
 * evaluated. Purely controlled: the caller owns when `value` actually gets
 * persisted (immediately for the global settings page's existing Save-
 * changes flow, or behind its own explicit save for the per-trader panel -
 * see components/traders/trader-settings-panel.tsx).
 */
export function TrailingStopsEditor({ value, onChange, disabled }: Props) {
  function updateRule(id: string, field: "armPercent" | "exitPercent", raw: number) {
    if (!Number.isFinite(raw)) return; // ignore a momentarily-empty input rather than writing NaN
    onChange(value.map((r) => (r._id === id ? { ...r, [field]: raw } : r)));
  }
  function removeRule(id: string) {
    onChange(value.filter((r) => r._id !== id));
  }
  function addRule() {
    onChange([...value, { _id: tempId(), armPercent: 25, exitPercent: -10 }]);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && <p className="text-xs text-muted-foreground">No trailing-stop rules configured.</p>}
      {value.map((rule) => (
        <div key={rule._id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
          <span className="text-xs text-muted-foreground">Arm at</span>
          <div className="relative w-24">
            <Input
              type="number"
              step={5}
              disabled={disabled}
              value={rule.armPercent}
              onChange={(e) => updateRule(rule._id, "armPercent", e.target.valueAsNumber)}
              className="h-8 pr-6 text-sm"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">%</span>
          </div>
          <span className="text-xs text-muted-foreground">gain, exit if it falls back to</span>
          <div className="relative w-24">
            <Input
              type="number"
              step={5}
              disabled={disabled}
              value={rule.exitPercent}
              onChange={(e) => updateRule(rule._id, "exitPercent", e.target.valueAsNumber)}
              className="h-8 pr-6 text-sm"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">%</span>
          </div>
          {!disabled && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground hover:text-negative"
              onClick={() => removeRule(rule._id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button variant="outline" size="sm" onClick={addRule} className="w-fit gap-1.5">
          <Plus className="size-3.5" /> Add rule
        </Button>
      )}
    </div>
  );
}
