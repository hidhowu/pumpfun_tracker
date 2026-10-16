"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** What a combined backtest adds to a normal one: the shared wallet (balance, trade amount, reset, negative balance) and editable fees. */
export type CombinedValues = {
  startingBalanceUsd: string;
  tradeSizeUsd: string;
  pumpFeePercent: string;
  jitoFeeUsd: string;
  resetDaily: boolean;
  allowNegativeBalance: boolean;
};

export type CombinedNumbers = {
  startingBalanceUsd: number;
  tradeSizeUsd: number;
  pumpFeePercent: number;
  jitoFeeUsd: number;
  resetDaily: boolean;
  allowNegativeBalance: boolean;
};

type NumberKey = "startingBalanceUsd" | "tradeSizeUsd" | "pumpFeePercent" | "jitoFeeUsd";

const FIELDS: Array<{ key: NumberKey; label: string; help: string; viewHelp?: string; min: number; max: number; strictlyAbove?: boolean; width?: string }> = [
  {
    key: "startingBalanceUsd",
    label: "Starting balance ($)",
    help: "The one balance every address trades from. Each buy takes its cost out, each sell puts the proceeds back, in the order the trades really happened.",
    min: 0,
    max: 1_000_000_000,
    strictlyAbove: true,
  },
  {
    key: "tradeSizeUsd",
    label: "Trade amount ($)",
    help: "Capital used for every single trade, whichever address it comes from. Changing it clears the results and simulates every address again.",
    viewHelp: "Capital used for every single trade. Every stored trade is scaled to this amount (a trade that made +50% on $20 makes +50% on $10), so it need not match the backtest's own amount.",
    min: 0,
    max: 1_000_000_000,
    strictlyAbove: true,
  },
  {
    key: "pumpFeePercent",
    label: "Pump fee (% of each trade)",
    help: "Charged on every buy and every sell. Copied from the profile (1.25% on pump.fun); change it to test another number. Changing it clears the results and simulates again.",
    viewHelp: "Charged on every buy and every sell, on this view's trade amounts. Independent of the fee the backtest was simulated with.",
    min: 0,
    max: 100,
  },
  {
    key: "jitoFeeUsd",
    label: "Jito fee ($ per transaction)",
    help: "A flat amount charged on every buy and every sell to land the transaction. Copied from the profile; lower or raise it to see what it does to the result. Changing it clears the results and simulates again.",
    viewHelp: "A flat amount charged on every buy and every sell. Independent of the fee the backtest was simulated with - a smaller trade amount usually deserves a smaller tip.",
    min: 0,
    max: 1000,
  },
];

const bad = (f: (typeof FIELDS)[number], raw: string) => {
  const n = Number(raw);
  return raw === "" || !Number.isFinite(n) || n < f.min || n > f.max || (f.strictlyAbove === true && n <= f.min);
};

export const toCombinedValues = (n: CombinedNumbers): CombinedValues => ({
  startingBalanceUsd: String(n.startingBalanceUsd),
  tradeSizeUsd: String(n.tradeSizeUsd),
  pumpFeePercent: String(n.pumpFeePercent),
  jitoFeeUsd: String(n.jitoFeeUsd),
  resetDaily: n.resetDaily,
  allowNegativeBalance: n.allowNegativeBalance,
});

/** null when a field is empty or out of range. */
export function parseCombined(v: CombinedValues): CombinedNumbers | null {
  if (FIELDS.some((f) => bad(f, v[f.key]))) return null;
  return {
    startingBalanceUsd: Number(v.startingBalanceUsd),
    tradeSizeUsd: Number(v.tradeSizeUsd),
    pumpFeePercent: Number(v.pumpFeePercent),
    jitoFeeUsd: Number(v.jitoFeeUsd),
    resetDaily: v.resetDaily,
    allowNegativeBalance: v.allowNegativeBalance,
  };
}

/**
 * The shared-wallet settings of a combined backtest. `lockedKeys` are the fields that need the backtest paused (they change what is simulated);
 * the balance, the daily reset and the negative-balance switch only change how the finished trades are added up, so they stay editable while it runs.
 */
export function CombinedFields({
  values,
  onChange,
  lockedKeys = [],
  idPrefix = "bt-combined",
  recalculated = false,
}: {
  values: CombinedValues;
  onChange: (next: CombinedValues) => void;
  lockedKeys?: NumberKey[];
  idPrefix?: string;
  /** true for a combined view: the stored trades are re-priced instead of simulated, so the help texts say that. */
  recalculated?: boolean;
}) {
  return (
    <div className="space-y-3">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${f.key}`}>{f.label}</Label>
          <Input
            id={`${idPrefix}-${f.key}`}
            inputMode="decimal"
            disabled={lockedKeys.includes(f.key)}
            value={values[f.key]}
            onChange={(e) => onChange({ ...values, [f.key]: e.target.value.replace(/[^0-9.]/g, "") })}
            className={cn("w-32", bad(f, values[f.key]) && "border-negative")}
            aria-invalid={bad(f, values[f.key])}
          />
          <p className="text-xs text-muted-foreground">{recalculated ? (f.viewHelp ?? f.help) : f.help}</p>
        </div>
      ))}

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor={`${idPrefix}-reset`}>Reset the balance every day</Label>
          <p className="text-xs text-muted-foreground">
            Every UTC day starts again from the starting balance, to see whether the group can hold its balance day after day. A trade counts for the day it was entered.
          </p>
        </div>
        <Switch id={`${idPrefix}-reset`} checked={values.resetDaily} onCheckedChange={(v) => onChange({ ...values, resetDaily: v })} />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor={`${idPrefix}-negative`}>Allow the balance to go negative</Label>
          <p className="text-xs text-muted-foreground">
            On: every buy is taken and each one that leaves the balance below zero is counted as a negative-balance event. Off: a buy the balance cannot pay is not taken.
          </p>
        </div>
        <Switch id={`${idPrefix}-negative`} checked={values.allowNegativeBalance} onCheckedChange={(v) => onChange({ ...values, allowNegativeBalance: v })} />
      </div>
    </div>
  );
}
