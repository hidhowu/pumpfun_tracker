"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type TimingValues = { executionDelaySeconds: string; riskCheckIntervalSeconds: string; fillLatencySeconds: string };
export type TimingNumbers = { executionDelaySeconds: number; riskCheckIntervalSeconds: number; fillLatencySeconds: number };

const FIELDS: Array<{ key: keyof TimingValues; label: string; help: string; max: number }> = [
  {
    key: "executionDelaySeconds",
    label: "Execution delay (seconds)",
    help: "Wait between spotting a trade and placing our order. Taken from the profile.",
    max: 60,
  },
  {
    key: "riskCheckIntervalSeconds",
    label: "Check prices every (seconds)",
    help: "How often open trades are looked at for stop-loss, take-profit, trailing stops and max hold - the live setting. A price spike between two checks is missed, just like live. 0 = look at every single pool trade.",
    max: 3600,
  },
  {
    key: "fillLatencySeconds",
    label: "Extra reaction time (seconds)",
    help: "Time live loses between a trade landing on chain and our order (noticing it, queueing it) on top of the delay. Live measures about 3s. 0 = react instantly.",
    max: 60,
  },
];

export const toTimingValues = (n: Partial<TimingNumbers> & { executionDelaySeconds: number }): TimingValues => ({
  executionDelaySeconds: String(n.executionDelaySeconds),
  riskCheckIntervalSeconds: String(n.riskCheckIntervalSeconds ?? 7),
  fillLatencySeconds: String(n.fillLatencySeconds ?? 3),
});

/** null when a field is empty or out of range. */
export function parseTiming(v: TimingValues): TimingNumbers | null {
  const out = {} as TimingNumbers;
  for (const { key, max } of FIELDS) {
    const n = Number(v[key]);
    if (v[key] === "" || !Number.isFinite(n) || n < 0 || n > max) return null;
    out[key] = n;
  }
  return out;
}

/** The three timing settings a backtest uses, editable before it starts (or while paused). */
export function TimingFields({ values, onChange, disabled }: { values: TimingValues; onChange: (next: TimingValues) => void; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      {FIELDS.map(({ key, label, help, max }) => {
        const n = Number(values[key]);
        const bad = values[key] === "" || !Number.isFinite(n) || n < 0 || n > max;
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={`bt-timing-${key}`}>{label}</Label>
            <Input
              id={`bt-timing-${key}`}
              inputMode="decimal"
              disabled={disabled}
              value={values[key]}
              onChange={(e) => onChange({ ...values, [key]: e.target.value.replace(/[^0-9.]/g, "") })}
              className={cn("w-24", bad && "border-negative")}
              aria-invalid={bad}
            />
            <p className="text-xs text-muted-foreground">{help}</p>
          </div>
        );
      })}
    </div>
  );
}
