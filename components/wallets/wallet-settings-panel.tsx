"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, ShieldAlert, SlidersHorizontal, Timer, Wallet as WalletIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { TrailingStopsEditor } from "@/components/trailing-stops-editor";
import { updateWalletSettings } from "@/lib/api";
import type { TrailingStop, WalletSettings } from "@/lib/types";

type Props = {
  walletId: string;
  settings: WalletSettings;
  onUpdated: (settings: WalletSettings) => void;
};

function NumberField({
  id,
  label,
  description,
  value,
  onSave,
  prefix,
  suffix,
  step = 1,
  min,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onSave: (value: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit() {
    const num = Number(draft);
    if (!Number.isFinite(num)) {
      setDraft(String(value));
      return;
    }
    if (num !== value) onSave(num);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">{prefix}</span>
        )}
        <Input
          id={id}
          type="number"
          step={step}
          min={min}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className={`${prefix ? "pl-7" : ""} ${suffix ? "pr-10" : ""}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{suffix}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

/** Stages trailing-stop edits locally and only saves (one API call) when "Save rules" is clicked - TrailingStopsEditor's onChange fires on every keystroke, so wiring it straight to a network save would fire one request per character typed. */
function TrailingStopsSection({ trailingStops, onSave }: { trailingStops: TrailingStop[]; onSave: (rules: TrailingStop[]) => void }) {
  const [draft, setDraft] = useState<TrailingStop[]>(trailingStops);

  useEffect(() => {
    setDraft(trailingStops);
  }, [trailingStops]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(trailingStops);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">Trailing stops</span>
        <span className="text-xs text-muted-foreground">
          {trailingStops.length} rule{trailingStops.length === 1 ? "" : "s"}
        </span>
      </div>
      <TrailingStopsEditor value={draft} onChange={setDraft} />
      {dirty && (
        <Button size="sm" className="w-fit" onClick={() => onSave(draft)}>
          Save rules
        </Button>
      )}
    </div>
  );
}

/**
 * A wallet's own flat settings form - unlike TraderSettingsPanel, there's no
 * override-vs-inherited-default dance here: a wallet has exactly ONE
 * settings object (independent of every Profile/trader), so every field is
 * a direct value that saves immediately.
 */
export function WalletSettingsPanel({ walletId, settings, onUpdated }: Props) {
  async function save(patch: Partial<WalletSettings>) {
    try {
      const { wallet } = await updateWalletSettings(walletId, patch);
      onUpdated(wallet.settings);
      toast.success("Wallet setting updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update setting");
    }
  }

  const hasStopLoss = settings.stopLossPercent !== null;
  const hasTakeProfit = settings.takeProfitPercent !== null;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="size-4 text-primary" /> Wallet settings
        </CardTitle>
        <CardDescription>
          Independent of any Profile or individual trader - these apply to every trade this wallet takes, using its
          own balance.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <WalletIcon className="size-3.5" /> TRADE SIZE &amp; FEE
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="w-tradeSize"
              label="Trade size"
              prefix="$"
              step={5}
              min={0}
              value={settings.tradeSizeUsd}
              onSave={(v) => save({ tradeSizeUsd: v })}
              description="USD spent per simulated buy on this wallet - independent of the trader's own trade size."
            />
            <NumberField
              id="w-fee"
              label="Flat fee per trade"
              prefix="$"
              step={0.1}
              min={0}
              value={settings.feeUsd}
              onSave={(v) => save({ feeUsd: v })}
              description="Deducted on both buy and sell, same as trader/global fee settings."
            />
          </div>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Coins className="size-3.5" /> BUY / SELL FILTERS
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="w-dustBuy"
              label="Dust-buy threshold"
              prefix="$"
              step={5}
              min={0}
              value={settings.dustBuyUsd}
              onSave={(v) => save({ dustBuyUsd: v })}
              description="Ignore a trader's buy below this USD value."
            />
            <NumberField
              id="w-dustSell"
              label="Dust-sell fraction"
              suffix="%"
              step={1}
              min={0}
              value={settings.dustSellFractionPercent}
              onSave={(v) => save({ dustSellFractionPercent: v })}
              description="Ignore a sell under this % of the trader's total bought amount."
            />
          </div>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldAlert className="size-3.5" /> RISK
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">Stop-loss</span>
                <span className="text-xs text-muted-foreground">
                  {hasStopLoss ? `${settings.stopLossPercent}%` : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {hasStopLoss && (
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
                <Switch checked={hasStopLoss} onCheckedChange={(checked) => save({ stopLossPercent: checked ? 60 : null })} />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">Take-profit</span>
                <span className="text-xs text-muted-foreground">
                  {hasTakeProfit ? `${settings.takeProfitPercent}%` : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {hasTakeProfit && (
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
                <Switch checked={hasTakeProfit} onCheckedChange={(checked) => save({ takeProfitPercent: checked ? 80 : null })} />
              </div>
            </div>

            <NumberField
              id="w-maxTradeTime"
              label="Max trade time"
              suffix="min"
              step={5}
              min={0}
              value={settings.maxTradeTimeSeconds / 60}
              onSave={(v) => save({ maxTradeTimeSeconds: Math.max(0, v) * 60 })}
              description="0 = no limit. e.g. 30 force-sells after 30 minutes if the trader still hasn't sold."
            />

            <TrailingStopsSection trailingStops={settings.trailingStops} onSave={(rules) => save({ trailingStops: rules })} />
          </div>
        </div>

        <Separator />

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Timer className="size-3.5" /> EXECUTION
          </div>
          <NumberField
            id="w-delay"
            label="Execution delay"
            suffix="sec"
            step={0.5}
            min={0}
            value={settings.executionDelaySeconds}
            onSave={(v) => save({ executionDelaySeconds: v })}
            description="Simulated latency before this wallet's fill."
          />
        </div>
      </CardContent>
    </Card>
  );
}
