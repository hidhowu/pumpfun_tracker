"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, Loader2, RefreshCw, ShieldAlert, SlidersHorizontal, Timer, TriangleAlert, Wallet as WalletIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
import { TrailingStopsEditor } from "@/components/trailing-stops-editor";
import { resetWallet, updateWalletSettings } from "@/lib/api";
import type { TrailingStop, WalletSettings, WalletView } from "@/lib/types";

type Props = {
  walletId: string;
  settings: WalletSettings;
  onUpdated: (settings: WalletSettings) => void;
  onReset?: (wallet: WalletView) => void;
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
  const dirty = draft !== String(value);

  useEffect(() => {
    // Same guard as TrailingStopsSection below - without it, the wallet
    // detail page's 10s poll would reset whatever's being typed here before
    // it's ever blurred/committed.
    if (!dirty) setDraft(String(value));
  }, [value, dirty]);

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
  const dirty = JSON.stringify(draft) !== JSON.stringify(trailingStops);

  useEffect(() => {
    // Only pull in the server's list while there's nothing unsaved locally -
    // the wallet detail page polls every 10s, and without this guard that
    // poll's fresh (but otherwise unchanged) array reference would wipe out
    // an in-progress edit, e.g. a newly-added rule, before Save is ever
    // clicked. Once dirty, this intentionally stops syncing until a save (or
    // a page reload) makes draft match the server again.
    if (!dirty) setDraft(trailingStops);
  }, [trailingStops, dirty]);

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
export function WalletSettingsPanel({ walletId, settings, onUpdated, onReset }: Props) {
  const [resetting, setResetting] = useState(false);

  async function save(patch: Partial<WalletSettings>) {
    try {
      const { wallet } = await updateWalletSettings(walletId, patch);
      onUpdated(wallet.settings);
      toast.success("Wallet setting updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update setting");
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const { wallet } = await resetWallet(walletId);
      onReset?.(wallet);
      toast.success("Wallet reset - balance back to starting balance, trade history cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset wallet");
    } finally {
      setResetting(false);
    }
  }

  const hasStopLoss = settings.stopLossPercent !== null;
  const hasTakeProfit = settings.takeProfitPercent !== null;

  return (
    <div className="flex flex-col gap-6">
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
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex min-w-0 flex-col">
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

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex min-w-0 flex-col">
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

    <Card className="border-negative/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-negative">
          <TriangleAlert className="size-4" /> Danger zone
        </CardTitle>
        <CardDescription>Irreversible actions affecting this wallet&apos;s own simulation only.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-negative/30 bg-negative/5 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Reset wallet</span>
            <span className="text-xs text-muted-foreground">
              Wipes every position and trade history, and resets balance back to the starting balance. Settings and
              assigned traders are untouched - only their per-wallet stats reset to zero alongside the trade history.
            </span>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={resetting} className="gap-1.5">
                {resetting ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset this wallet&apos;s simulation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This wipes every position and trade history back to a fresh starting balance. Settings and assigned
                  traders stay exactly as they are - only trade history and the stats derived from it are cleared.
                  This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-negative text-negative-foreground hover:bg-negative/90"
                  onClick={handleReset}
                >
                  Reset wallet
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
