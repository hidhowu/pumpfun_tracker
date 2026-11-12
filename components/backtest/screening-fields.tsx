"use client";

import { Input } from "@/components/ui/input";
import { SettingsList, SettingsRow } from "@/components/ui/settings-row";
import { cn } from "@/lib/utils";
import type { EarlyStopRules } from "@/lib/backtest-api";

export type ScreeningValues = { addressParallelism: string; daysAtOnce: string; lossDays: string; dayLossPercent: string; negativeBalanceEvents: string; lossAtProgressPercent: string };
export type ScreeningNumbers = { addressParallelism: number | null; daysAtOnce: number; earlyStop: EarlyStopRules };

type Field = { key: keyof ScreeningValues; label: string; help: string; max: number; whole: boolean; placeholder?: string };

const FIELDS: Field[] = [
  {
    key: "addressParallelism",
    label: "Addresses at once",
    help: "How many addresses run first; the same number wait on standby and take the capacity the front ones leave free. Empty = automatic.",
    max: 500,
    whole: true,
  },
  {
    key: "daysAtOnce",
    label: "Days at once (per address)",
    help: "How many days of one address run at once. 1 = finish a day first, so the loss rules judge whole days. 0 = no limit, faster. Can change while it runs.",
    max: 1000,
    whole: true,
  },
  {
    key: "lossDays",
    label: "Stop after this many losing days",
    help: "Drops a trader after this many full days closed in a loss (they need not follow each other). 0 = off.",
    max: 1000,
    whole: true,
  },
  {
    key: "dayLossPercent",
    label: "Stop if one day loses more than (%)",
    help: "Drops a trader when one full day's loss reaches this %, e.g. 1000 = -1000%. 0 = off.",
    max: 1_000_000,
    whole: false,
  },
  {
    key: "negativeBalanceEvents",
    label: "Stop after the balance goes negative this many times",
    help: "Drops a trader after this many negative-balance events (only when the profile allows a negative balance). 0 = off.",
    max: 100_000,
    whole: true,
  },
  {
    key: "lossAtProgressPercent",
    label: "Stop at this share of tokens if still losing (%)",
    help: "After this % of the trader's tokens are done, a trader whose realized P&L is still negative is dropped, e.g. 75. 0 = off.",
    max: 100,
    whole: false,
  },
];

export const toScreeningValues = (run: { earlyStop?: Partial<EarlyStopRules>; addressParallelism?: number | null; daysAtOnce?: number }): ScreeningValues => ({
  addressParallelism: run.addressParallelism ? String(run.addressParallelism) : "",
  daysAtOnce: String(run.daysAtOnce ?? 0),
  lossDays: String(run.earlyStop?.lossDays ?? 0),
  dayLossPercent: String(run.earlyStop?.dayLossPercent ?? 0),
  negativeBalanceEvents: String(run.earlyStop?.negativeBalanceEvents ?? 0),
  lossAtProgressPercent: String(run.earlyStop?.lossAtProgressPercent ?? 0),
});

function invalid(f: Field, raw: string) {
  if ((f.key === "addressParallelism" || f.key === "daysAtOnce") && raw === "") return false; // automatic / no limit
  const n = Number(raw);
  return raw === "" || !Number.isFinite(n) || n < (f.key === "addressParallelism" ? 1 : 0) || n > f.max || (f.whole && !Number.isInteger(n));
}

/** null when a field is out of range. */
export function parseScreening(v: ScreeningValues): ScreeningNumbers | null {
  if (FIELDS.some((f) => invalid(f, v[f.key]))) return null;
  return {
    addressParallelism: v.addressParallelism === "" ? null : Number(v.addressParallelism),
    daysAtOnce: v.daysAtOnce === "" ? 0 : Number(v.daysAtOnce),
    earlyStop: { lossDays: Number(v.lossDays), dayLossPercent: Number(v.dayLossPercent), negativeBalanceEvents: Number(v.negativeBalanceEvents), lossAtProgressPercent: Number(v.lossAtProgressPercent) },
  };
}

/** The speed and loss-trader settings of a backtest: how many addresses run at once, and when a losing trader is dropped early. */
export function ScreeningFields({
  values,
  onChange,
  disabled,
  disabledKeys = [],
  autoParallelism,
  speedOnly,
}: {
  values: ScreeningValues;
  onChange: (next: ScreeningValues) => void;
  disabled?: boolean;
  /** Fields that stay editable while `disabled` is set (the address and day counts can change while a backtest runs). */
  disabledKeys?: Array<keyof ScreeningValues>;
  autoParallelism?: number;
  /** Only the speed fields ("addresses at once", "days at once") - a combined backtest has no loss-trader rules (dropping one address would change the wallet the others share). */
  speedOnly?: boolean;
}) {
  return (
    <SettingsList>
      {FIELDS.filter((f) => !speedOnly || f.key === "addressParallelism" || f.key === "daysAtOnce").map((f) => {
        const bad = invalid(f, values[f.key]);
        const locked = disabled && !disabledKeys.includes(f.key);
        return (
          <SettingsRow key={f.key} label={f.label} help={f.help} htmlFor={`bt-screen-${f.key}`}>
            <Input
              id={`bt-screen-${f.key}`}
              inputMode={f.whole ? "numeric" : "decimal"}
              disabled={locked}
              placeholder={f.key === "addressParallelism" && autoParallelism ? `auto (${autoParallelism})` : undefined}
              value={values[f.key]}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value.replace(f.whole ? /[^0-9]/g : /[^0-9.]/g, "") })}
              className={cn("w-[110px] text-right", bad && "border-negative")}
              aria-invalid={bad}
            />
          </SettingsRow>
        );
      })}
    </SettingsList>
  );
}
