"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, RefreshCw, RotateCcw, ShieldAlert, SlidersHorizontal, Timer, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resetTrader, updateTraderSettings } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import type { EffectiveSettings, TraderDetail, TraderSimSettings, TrailingStop } from "@/lib/types";
import { TrailingStopsEditor } from "@/components/trailing-stops-editor";

type Props = {
  address: string;
  settings: TraderSimSettings;
  effectiveSettings: EffectiveSettings;
  onUpdated: (next: { settings: TraderSimSettings; effectiveSettings: EffectiveSettings }) => void;
  onReset?: (trader: TraderDetail) => void;
};

function OverrideField({
  id,
  label,
  description,
  override,
  effective,
  onSave,
  onClear,
  prefix,
  suffix,
  step = 1,
  min,
}: {
  id: string;
  label: string;
  description: string;
  override: number | null;
  effective: number;
  onSave: (value: number) => void;
  onClear: () => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
}) {
  const [draft, setDraft] = useState<string>(override !== null ? String(override) : "");
  const isOverridden = override !== null;

  function commit() {
    if (draft === "") {
      onClear();
      return;
    }
    const num = Number(draft);
    if (!Number.isFinite(num)) {
      setDraft(override !== null ? String(override) : "");
      return;
    }
    onSave(num);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id}>{label}</Label>
        {isOverridden ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  onClear();
                }}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
              >
                <RotateCcw className="size-3" /> reset to default
              </button>
            </TooltipTrigger>
            <TooltipContent>Clears the override and inherits the global default again</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-[11px] text-muted-foreground">inherited: {prefix ?? ""}{effective}{suffix ?? ""}</span>
        )}
      </div>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <Input
          id={id}
          type="number"
          step={step}
          min={min}
          placeholder={String(effective)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className={`${prefix ? "pl-7" : ""} ${suffix ? "pr-10" : ""} ${isOverridden ? "border-primary/50" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function TrailingStopsOverride({
  override,
  effective,
  onSave,
  onClear,
}: {
  override: TrailingStop[] | null;
  effective: TrailingStop[];
  onSave: (rules: TrailingStop[]) => void;
  onClear: () => void;
}) {
  const isOverridden = override !== null;
  const [draft, setDraft] = useState<TrailingStop[]>(override ?? effective);
  const dirty = isOverridden && JSON.stringify(draft) !== JSON.stringify(override);

  useEffect(() => {
    // Only pull in the server's value while there's nothing unsaved locally -
    // the trader detail page polls every 10s, and without this guard that
    // poll's fresh (but otherwise unchanged) array reference would wipe out
    // an in-progress edit, e.g. a newly-added rule, before Save rules is
    // ever clicked.
    if (!dirty) setDraft(override ?? effective);
  }, [override, effective, dirty]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">Trailing stops</span>
          <span className="text-xs text-muted-foreground">
            {isOverridden
              ? "Overridden for this trader"
              : `Inherited from global default (${effective.length} rule${effective.length === 1 ? "" : "s"})`}
          </span>
        </div>
        <Switch
          checked={isOverridden}
          onCheckedChange={(checked) => {
            if (checked) {
              setDraft(effective);
              onSave(effective); // starts the override as a copy of the current effective list
            } else {
              onClear();
            }
          }}
        />
      </div>
      <TrailingStopsEditor value={draft} onChange={setDraft} disabled={!isOverridden} />
      {isOverridden && dirty && (
        <Button size="sm" className="w-fit" onClick={() => onSave(draft)}>
          Save rules
        </Button>
      )}
    </div>
  );
}

export function TraderSettingsPanel({ address, settings, effectiveSettings, onUpdated, onReset }: Props) {
  const { currentProfileId } = useProfile();
  const [resetting, setResetting] = useState(false);

  async function save(patch: Partial<TraderSimSettings>) {
    if (!currentProfileId) return;
    try {
      const result = await updateTraderSettings(currentProfileId, address, patch);
      onUpdated(result);
      toast.success("Trader setting updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update setting");
    }
  }

  async function handleReset() {
    if (!currentProfileId) return;
    setResetting(true);
    try {
      const { trader } = await resetTrader(currentProfileId, address);
      onReset?.(trader);
      toast.success("Simulation reset - balance back to starting allocation");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset simulation");
    } finally {
      setResetting(false);
    }
  }

  const stopLossOverridden = settings.stopLossPercent !== null;
  const takeProfitOverridden = settings.takeProfitPercent !== null;
  const negBalanceOverridden = settings.allowNegativeBalance !== null;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="size-4 text-primary" /> Trader settings
        </CardTitle>
        <CardDescription>
          Overrides for this trader only. Anything left blank inherits the global default from Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Wallet className="size-3.5" /> CAPITAL
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <OverrideField
              id="ov-allocation"
              label="Starting allocation"
              prefix="$"
              step={10}
              min={0}
              override={settings.allocationUsd}
              effective={effectiveSettings.allocationUsd}
              onSave={(v) => save({ allocationUsd: v })}
              onClear={() => save({ allocationUsd: null })}
              description="Only takes effect before this trader's balance has been initialized."
            />
            <OverrideField
              id="ov-tradeSize"
              label="Trade size"
              prefix="$"
              step={5}
              min={0}
              override={settings.tradeSizeUsd}
              effective={effectiveSettings.tradeSizeUsd}
              onSave={(v) => save({ tradeSizeUsd: v })}
              onClear={() => save({ tradeSizeUsd: null })}
              description="USD spent per simulated buy for this trader."
            />
          </div>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Coins className="size-3.5" /> BUY / SELL FILTERS
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <OverrideField
              id="ov-dustBuy"
              label="Dust-buy threshold"
              prefix="$"
              step={5}
              min={0}
              override={settings.dustBuyUsd}
              effective={effectiveSettings.dustBuyUsd}
              onSave={(v) => save({ dustBuyUsd: v })}
              onClear={() => save({ dustBuyUsd: null })}
              description="Ignore this trader's buys below this USD value."
            />
            <OverrideField
              id="ov-dustSell"
              label="Dust-sell fraction"
              suffix="%"
              step={1}
              min={0}
              override={settings.dustSellFractionPercent}
              effective={effectiveSettings.dustSellFractionPercent}
              onSave={(v) => save({ dustSellFractionPercent: v })}
              onClear={() => save({ dustSellFractionPercent: null })}
              description="Ignore a sell under this % of their total bought amount."
            />
          </div>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldAlert className="size-3.5" /> RISK
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Stop-loss</span>
                <span className="text-xs text-muted-foreground">
                  {stopLossOverridden
                    ? `Overridden for this trader: ${settings.stopLossPercent}%`
                    : effectiveSettings.stopLossPercent !== null
                      ? `Inherited from global default: ${effectiveSettings.stopLossPercent}%`
                      : "Inherited from global default: disabled"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {stopLossOverridden && (
                  <Input
                    type="number"
                    step={5}
                    min={1}
                    className="h-8 w-20"
                    defaultValue={settings.stopLossPercent ?? undefined}
                    onBlur={(e) => {
                      const num = Number(e.target.value);
                      if (Number.isFinite(num)) save({ stopLossPercent: num });
                    }}
                  />
                )}
                <Switch
                  checked={stopLossOverridden}
                  onCheckedChange={(checked) => save({ stopLossPercent: checked ? effectiveSettings.stopLossPercent ?? 60 : null })}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Take-profit</span>
                <span className="text-xs text-muted-foreground">
                  {takeProfitOverridden
                    ? `Overridden for this trader: ${settings.takeProfitPercent}%`
                    : effectiveSettings.takeProfitPercent !== null
                      ? `Inherited from global default: ${effectiveSettings.takeProfitPercent}%`
                      : "Inherited from global default: disabled"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {takeProfitOverridden && (
                  <Input
                    type="number"
                    step={5}
                    min={1}
                    className="h-8 w-20"
                    defaultValue={settings.takeProfitPercent ?? undefined}
                    onBlur={(e) => {
                      const num = Number(e.target.value);
                      if (Number.isFinite(num)) save({ takeProfitPercent: num });
                    }}
                  />
                )}
                <Switch
                  checked={takeProfitOverridden}
                  onCheckedChange={(checked) => save({ takeProfitPercent: checked ? effectiveSettings.takeProfitPercent ?? 80 : null })}
                />
              </div>
            </div>

            <OverrideField
              id="ov-maxTradeTime"
              label="Max trade time"
              suffix="min"
              step={5}
              min={0}
              override={settings.maxTradeTimeSeconds !== null ? settings.maxTradeTimeSeconds / 60 : null}
              effective={effectiveSettings.maxTradeTimeSeconds / 60}
              onSave={(v) => save({ maxTradeTimeSeconds: Math.max(0, v) * 60 })}
              onClear={() => save({ maxTradeTimeSeconds: null })}
              description="0 = no limit. e.g. 30 force-sells after 30 minutes if the trader still hasn't sold."
            />

            <TrailingStopsOverride
              override={settings.trailingStops}
              effective={effectiveSettings.trailingStops}
              onSave={(rules) => save({ trailingStops: rules })}
              onClear={() => save({ trailingStops: null })}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">Allow negative balance</span>
                <span className="text-xs text-muted-foreground">
                  {negBalanceOverridden ? "Overridden for this trader" : "Inherited from global default"} —{" "}
                  {effectiveSettings.allowNegativeBalance ? "on" : "off"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={effectiveSettings.allowNegativeBalance}
                  onCheckedChange={(checked) => save({ allowNegativeBalance: checked })}
                />
                {negBalanceOverridden && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => save({ allowNegativeBalance: null })}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <RotateCcw className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Reset to global default</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Timer className="size-3.5" /> EXECUTION &amp; FEES
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <OverrideField
              id="ov-delay"
              label="Execution delay"
              suffix="sec"
              step={0.5}
              min={0}
              override={settings.executionDelaySeconds}
              effective={effectiveSettings.executionDelaySeconds}
              onSave={(v) => save({ executionDelaySeconds: v })}
              onClear={() => save({ executionDelaySeconds: null })}
              description="Simulated latency before our fill, for this trader."
            />
            <OverrideField
              id="ov-fee"
              label="Flat fee per trade"
              prefix="$"
              step={0.1}
              min={0}
              override={settings.feeUsd}
              effective={effectiveSettings.feeUsd}
              onSave={(v) => save({ feeUsd: v })}
              onClear={() => save({ feeUsd: null })}
              description="Deducted on both buy and sell for this trader."
            />
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/10 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Reset simulation</span>
            <span className="text-xs text-muted-foreground">
              Wipes this trader&apos;s positions and trade history, and resets balance back to their starting allocation.
            </span>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={resetting}>
                <RefreshCw className="size-4" /> Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset this trader&apos;s simulation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This wipes this trader&apos;s positions, trade history, and P&amp;L back to their starting balance.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReset} className="bg-negative text-negative-foreground hover:bg-negative/90">
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
