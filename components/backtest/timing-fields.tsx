"use client";

import { Input } from "@/components/ui/input";
import { SettingsList, SettingsRow } from "@/components/ui/settings-row";
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
    help: "How often open trades are checked for exits (stop-loss, take-profit, trailing, max hold). Like live, a spike between two checks is missed. 0 = every pool trade.",
    max: 3600,
  },
  {
    key: "fillLatencySeconds",
    label: "Extra reaction time (seconds)",
    help: "Extra time live needs to react to a trade, on top of the delay (about 3s measured). 0 = instant.",
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
    <SettingsList>
      {FIELDS.map(({ key, label, help, max }) => {
        const n = Number(values[key]);
        const bad = values[key] === "" || !Number.isFinite(n) || n < 0 || n > max;
        return (
          <SettingsRow key={key} label={label} help={help} htmlFor={`bt-timing-${key}`}>
            <Input
              id={`bt-timing-${key}`}
              inputMode="decimal"
              disabled={disabled}
              value={values[key]}
              onChange={(e) => onChange({ ...values, [key]: e.target.value.replace(/[^0-9.]/g, "") })}
              className={cn("w-[110px] text-right", bad && "border-negative")}
              aria-invalid={bad}
            />
          </SettingsRow>
        );
      })}
    </SettingsList>
  );
}
