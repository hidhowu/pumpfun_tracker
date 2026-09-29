"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BellOff,
  BellRing,
  Coins,
  Settings2,
  ShieldAlert,
  Timer,
  Wallet,
  TriangleAlert,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { getSettings, updateSettings, resetAllTraders } from "@/lib/api";
import type { GlobalSettings } from "@/lib/types";
import { TrailingStopsEditor } from "@/components/trailing-stops-editor";
import { useProfile } from "@/lib/profile-context";

type Draft = GlobalSettings;

function NumberField({
  id,
  label,
  description,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  min,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
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
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className={prefix ? "pl-7" : suffix ? "pr-10" : undefined}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { currentProfileId } = useProfile();
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (!currentProfileId) return;
    getSettings(currentProfileId)
      .then(({ settings }) => {
        setSaved(settings);
        setDraft(settings);
      })
      .catch(() => toast.error("Failed to load settings"));
  }, [currentProfileId]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleDefaultMutedChange(checked: boolean) {
    if (!currentProfileId) return;
    // "muted" means notifications OFF, so the switch label is inverted from defaultMuted.
    const defaultMuted = !checked;
    set("defaultMuted", defaultMuted);
    try {
      const { settings } = await updateSettings(currentProfileId, { defaultMuted });
      setSaved(settings);
      setDraft(settings);
      toast.success(`Notifications are now ${defaultMuted ? "off" : "on"} by default for new traders`);
    } catch {
      toast.error("Failed to update settings");
    }
  }

  const dirty = draft && saved && JSON.stringify(draft) !== JSON.stringify(saved);

  async function handleResetAll() {
    if (!currentProfileId) return;
    setResetting(true);
    try {
      const { reset } = await resetAllTraders(currentProfileId);
      toast.success(`Reset ${reset.length} trader${reset.length === 1 ? "" : "s"} back to their starting balance`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset traders");
    } finally {
      setResetting(false);
    }
  }

  async function handleSave() {
    if (!draft || !currentProfileId) return;
    setSaving(true);
    try {
      const { settings } = await updateSettings(currentProfileId, draft);
      setSaved(settings);
      setDraft(settings);
      toast.success("Simulation defaults saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pb-16">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Settings2 className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Defaults for the currently-selected profile&apos;s strategy. Any trader can override these individually,
              within this profile - other profiles have their own independent settings.
            </p>
          </div>
        </div>
        {dirty && (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        )}
      </div>

      {/* Capital */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4 text-primary" /> Capital
          </CardTitle>
          <CardDescription>
            Starting paper capital and how much of it gets spent on each simulated buy.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="allocation"
            label="Starting allocation"
            prefix="$"
            step={10}
            min={0}
            value={draft.defaultAllocationUsd}
            onChange={(v) => set("defaultAllocationUsd", v)}
            description="Paper capital a new trader starts with. Only applies at first-init — changing this later doesn't rewrite an existing trader's balance."
          />
          <NumberField
            id="tradeSize"
            label="Trade size"
            prefix="$"
            step={5}
            min={0}
            value={draft.defaultTradeSizeUsd}
            onChange={(v) => set("defaultTradeSizeUsd", v)}
            description="USD spent per simulated buy, regardless of how much the real trader spent."
          />
        </CardContent>
      </Card>

      {/* Buy filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="size-4 text-primary" /> Buy filters
          </CardTitle>
          <CardDescription>Avoid mirroring trades that aren&apos;t real signal.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="dustBuy"
            label="Dust-buy threshold"
            prefix="$"
            step={5}
            min={0}
            value={draft.defaultDustBuyUsd}
            onChange={(v) => set("defaultDustBuyUsd", v)}
            description="Ignore a trader's buy if its current USD value is below this. We keep watching for a qualifying buy — a mint is only ever bought (or permanently skipped) once."
          />
          <NumberField
            id="dustSell"
            label="Dust-sell fraction"
            suffix="%"
            step={1}
            min={0}
            value={draft.defaultDustSellFractionPercent}
            onChange={(v) => set("defaultDustSellFractionPercent", v)}
            description="Ignore a sell if it's less than this % of the trader's total bought amount for that mint. A full exit still counts even if the leftover slice is tiny."
          />
        </CardContent>
      </Card>

      {/* Sell filters & risk */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-primary" /> Risk
          </CardTitle>
          <CardDescription>Our own protective exit, and what happens when capital runs out.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Stop-loss</span>
              <span className="text-xs text-muted-foreground">
                Force-close a position at this % unrealized loss, regardless of whether the trader has sold.
              </span>
            </div>
            <Switch
              checked={draft.defaultStopLossPercent !== null}
              onCheckedChange={(checked) => set("defaultStopLossPercent", checked ? 60 : null)}
            />
          </div>
          {draft.defaultStopLossPercent !== null && (
            <NumberField
              id="stopLoss"
              label="Stop-loss level"
              suffix="%"
              step={5}
              min={1}
              value={draft.defaultStopLossPercent}
              onChange={(v) => set("defaultStopLossPercent", v)}
              description="e.g. 60 closes the position once it's down 60% from cost basis."
            />
          )}

          <Separator />

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Take-profit</span>
              <span className="text-xs text-muted-foreground">
                Force-close a position once it reaches this % unrealized gain, regardless of whether the trader has sold.
              </span>
            </div>
            <Switch
              checked={draft.defaultTakeProfitPercent !== null}
              onCheckedChange={(checked) => set("defaultTakeProfitPercent", checked ? 80 : null)}
            />
          </div>
          {draft.defaultTakeProfitPercent !== null && (
            <NumberField
              id="takeProfit"
              label="Take-profit level"
              suffix="%"
              step={5}
              min={1}
              value={draft.defaultTakeProfitPercent}
              onChange={(v) => set("defaultTakeProfitPercent", v)}
              description="e.g. 80 closes the position once it's up 80% from cost basis."
            />
          )}

          <Separator />

          <NumberField
            id="maxTradeTime"
            label="Max trade time"
            suffix="min"
            step={5}
            min={0}
            value={draft.defaultMaxTradeTimeSeconds / 60}
            onChange={(v) => set("defaultMaxTradeTimeSeconds", Math.max(0, v) * 60)}
            description="0 = no limit (wait for the trader to sell, or another exit to trigger). e.g. 30 force-sells a position after 30 minutes if the trader still hasn't sold."
          />

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Trailing stops</span>
              <span className="text-xs text-muted-foreground">
                Any number of independent rules: once a position first reaches "arm at" %, it auto-sells if it later
                falls back to "exit at" % (which can be negative, e.g. arm at +25%, exit at -10%). Whichever
                configured rule triggers first closes the position.
              </span>
            </div>
            <TrailingStopsEditor
              value={draft.defaultTrailingStops}
              onChange={(next) => set("defaultTrailingStops", next)}
            />
          </div>

          <Separator />

          <NumberField
            id="riskCheckInterval"
            label="Risk check interval"
            suffix="sec"
            step={5}
            min={5}
            value={draft.riskCheckIntervalSeconds}
            onChange={(v) => set("riskCheckIntervalSeconds", v)}
            description="How often the daemon re-checks every open position against stop-loss/take-profit/bench (minimum 5s). This is a system-wide cadence, not a per-trader setting - takes effect immediately, no restart needed."
          />

          <Separator />

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Allow negative balance</span>
              <span className="text-xs text-muted-foreground">
                {draft.defaultAllowNegativeBalance
                  ? "On — a trader can keep buying past $0, going into debt (tracked separately)."
                  : "Off — a buy is skipped entirely once balance can't cover the trade size."}
              </span>
            </div>
            <Switch
              checked={draft.defaultAllowNegativeBalance}
              onCheckedChange={(checked) => set("defaultAllowNegativeBalance", checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Execution & fees */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="size-4 text-primary" /> Execution &amp; fees
          </CardTitle>
          <CardDescription>Models the latency and costs of a real trade.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="delay"
            label="Execution delay"
            suffix="sec"
            step={0.5}
            min={0}
            value={draft.defaultExecutionDelaySeconds}
            onChange={(v) => set("defaultExecutionDelaySeconds", v)}
            description="Simulated latency between detecting a trade and filling our own order."
          />
          <NumberField
            id="fee"
            label="Flat fee per trade"
            prefix="$"
            step={0.1}
            min={0}
            value={draft.defaultFeeUsd}
            onChange={(v) => set("defaultFeeUsd", v)}
            description="Deducted on both the buy and the sell (creator fee + gas, modeled as one flat cost)."
          />
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {draft.defaultMuted ? (
              <BellOff className="size-4 text-muted-foreground" />
            ) : (
              <BellRing className="size-4 text-primary" />
            )}
            Notifications by default
          </CardTitle>
          <CardDescription>
            Whether a newly-added trader is notified on by default. Any trader can override this
            individually from their detail page — this only applies when a trader has no override
            of their own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Notify on new trades by default</span>
              <span className="text-xs text-muted-foreground">
                {draft.defaultMuted ? "Currently off — new traders start muted." : "Currently on — new traders start unmuted."}
              </span>
            </div>
            <Switch checked={!draft.defaultMuted} onCheckedChange={handleDefaultMutedChange} />
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-negative/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-negative">
            <TriangleAlert className="size-4" /> Danger zone
          </CardTitle>
          <CardDescription>Irreversible actions affecting every tracked trader, within this profile only.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border border-negative/30 bg-negative/5 px-4 py-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">Reset all traders&apos; simulations (this profile)</span>
              <span className="text-xs text-muted-foreground">
                Wipes every active trader&apos;s positions, trade history, and P&amp;L back to a fresh starting balance
                - in this profile only. Other profiles are untouched.
              </span>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={resetting} className="gap-1.5">
                  <RotateCcw className="size-3.5" />
                  Reset all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset every active trader&apos;s simulation in this profile?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This wipes every active trader&apos;s positions, trade history, and P&amp;L back to a fresh
                    starting balance, in this profile only. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-negative text-negative-foreground hover:bg-negative/90"
                    onClick={handleResetAll}
                  >
                    Reset all traders
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">This is a local-only dashboard — there&apos;s no login.</p>
    </div>
  );
}
