"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TrailingStop } from "@/lib/types";

type Props = {
  value: TrailingStop[];
  onChange: (next: TrailingStop[]) => void;
  disabled?: boolean;
  /** Extra controls shown on the same row as "Add rule" (e.g. a Save button). */
  actions?: React.ReactNode;
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
export function TrailingStopsEditor({ value, onChange, disabled, actions }: Props) {
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
    <div className="flex flex-col gap-3">
      {value.length === 0 && <p className="text-xs text-text-3">No trailing-stop rules configured.</p>}
      {value.map((rule) => (
        <div key={rule._id} className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
          <span className="text-xs text-text-3">Arm at</span>
          <div className="relative w-24">
            <Input type="number" step={5} disabled={disabled} value={rule.armPercent} onChange={(e) => updateRule(rule._id, "armPercent", e.target.valueAsNumber)} aria-label="Arm at percent gain" className="h-8 rounded-lg pr-6 text-[13px] md:text-[13px]" />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-text-3">%</span>
          </div>
          <span className="text-xs text-text-3">gain, exit if it falls back to</span>
          <div className="relative w-24">
            <Input type="number" step={5} disabled={disabled} value={rule.exitPercent} onChange={(e) => updateRule(rule._id, "exitPercent", e.target.valueAsNumber)} aria-label="Exit percent" className="h-8 rounded-lg pr-6 text-[13px] md:text-[13px]" />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-text-3">%</span>
          </div>
          {!disabled && (
            <Button variant="ghost" size="icon-sm" className="ml-auto text-text-3 hover:text-negative max-md:size-9" onClick={() => removeRule(rule._id)} aria-label="Remove rule">
              <Trash2 />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={addRule}>
            <Plus className="size-3.5" /> Add rule
          </Button>
          {actions}
        </div>
      )}
    </div>
  );
}
