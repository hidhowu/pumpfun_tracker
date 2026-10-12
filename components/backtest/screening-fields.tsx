"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { EarlyStopRules } from "@/lib/backtest-api";

export type ScreeningValues = { addressParallelism: string; lossDays: string; dayLossPercent: string; negativeBalanceEvents: string; lossAtProgressPercent: string };
export type ScreeningNumbers = { addressParallelism: number | null; earlyStop: EarlyStopRules };

type Field = { key: keyof ScreeningValues; label: string; help: string; max: number; whole: boolean; placeholder?: string };

const FIELDS: Field[] = [
  {
    key: "addressParallelism",
    label: "Addresses at once",
    help: "How many addresses are worked on at the same time. Lower it (1 = one by one) so each address gets every proxy and finishes fast, instead of many crawling together. Empty = automatic.",
    max: 500,
    whole: true,
  },
  {
    key: "lossDays",
    label: "Stop after this many losing days",
    help: "A trader is assumed a loss and dropped once this many full days closed in a loss (they need not follow each other), even if tokens are left. 0 = off.",
    max: 1000,
    whole: true,
  },
  {
    key: "dayLossPercent",
    label: "Stop if one day loses more than (%)",
    help: "Dropped as soon as a full day's combined result reaches this loss, e.g. 1000 for -1000% (the figure the daily breakdown shows). 0 = off.",
    max: 1_000_000,
    whole: false,
  },
  {
    key: "negativeBalanceEvents",
    label: "Stop after the balance goes negative this many times",
    help: "Each buy that leaves the simulated wallet's cash below zero is one negative-balance event (the count the address page shows). Reaching this many marks the trader a loss, even if it would have recovered. Only applies when the profile allows a negative balance. 0 = off.",
    max: 100_000,
    whole: true,
  },
  {
    key: "lossAtProgressPercent",
    label: "Stop at this share of tokens if still losing (%)",
    help: "Once this percent of the trader's tokens are processed, a trader whose realized P&L is still negative is dropped. e.g. 75. 0 = off.",
    max: 100,
    whole: false,
  },
];

export const toScreeningValues = (run: { earlyStop?: Partial<EarlyStopRules>; addressParallelism?: number | null }): ScreeningValues => ({
  addressParallelism: run.addressParallelism ? String(run.addressParallelism) : "",
  lossDays: String(run.earlyStop?.lossDays ?? 0),
  dayLossPercent: String(run.earlyStop?.dayLossPercent ?? 0),
  negativeBalanceEvents: String(run.earlyStop?.negativeBalanceEvents ?? 0),
  lossAtProgressPercent: String(run.earlyStop?.lossAtProgressPercent ?? 0),
});

function invalid(f: Field, raw: string) {
  if (f.key === "addressParallelism" && raw === "") return false; // automatic
  const n = Number(raw);
  return raw === "" || !Number.isFinite(n) || n < (f.key === "addressParallelism" ? 1 : 0) || n > f.max || (f.whole && !Number.isInteger(n));
}

/** null when a field is out of range. */
export function parseScreening(v: ScreeningValues): ScreeningNumbers | null {
  if (FIELDS.some((f) => invalid(f, v[f.key]))) return null;
  return {
    addressParallelism: v.addressParallelism === "" ? null : Number(v.addressParallelism),
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
}: {
  values: ScreeningValues;
  onChange: (next: ScreeningValues) => void;
  disabled?: boolean;
  /** Fields that stay editable while `disabled` is set (the address count can change while a backtest runs). */
  disabledKeys?: Array<keyof ScreeningValues>;
  autoParallelism?: number;
}) {
  return (
    <div className="space-y-3">
      {FIELDS.map((f) => {
        const bad = invalid(f, values[f.key]);
        const locked = disabled && !disabledKeys.includes(f.key);
        return (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`bt-screen-${f.key}`}>{f.label}</Label>
            <Input
              id={`bt-screen-${f.key}`}
              inputMode={f.whole ? "numeric" : "decimal"}
              disabled={locked}
              placeholder={f.key === "addressParallelism" && autoParallelism ? `auto (${autoParallelism})` : undefined}
              value={values[f.key]}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value.replace(f.whole ? /[^0-9]/g : /[^0-9.]/g, "") })}
              className={cn("w-32", bad && "border-negative")}
              aria-invalid={bad}
            />
            <p className="text-xs text-muted-foreground">{f.help}</p>
          </div>
        );
      })}
    </div>
  );
}
