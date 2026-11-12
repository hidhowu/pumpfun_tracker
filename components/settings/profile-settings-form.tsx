"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Activity, BellOff, BellRing, ChevronLeft, Filter, Info, Pencil, RotateCcw, ShieldAlert, Timer, TriangleAlert, Waves, Wallet } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { SectionNav, type SectionNavItem } from "@/components/ui/section-nav";
import { Skeleton } from "@/components/ui/skeleton";
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
import { getSettings, renameProfile, updateSettings, resetAllTraders } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import type { GlobalSettings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TrailingStopsEditor } from "@/components/trailing-stops-editor";
import { Section, ToggleRow } from "@/components/settings/parts";

type Draft = GlobalSettings;

const SECTIONS: SectionNavItem[] = [
  { id: "set-capital", label: "Capital", icon: Wallet },
  { id: "set-filters", label: "Buy filters", icon: Filter },
  { id: "set-risk", label: "Risk exits", icon: ShieldAlert },
  { id: "set-execution", label: "Execution & fees", icon: Timer },
  { id: "set-trading", label: "Trading", icon: Activity },
  { id: "set-notify", label: "Notifications", icon: BellRing },
  { id: "set-danger", label: "Danger zone", icon: TriangleAlert, danger: true },
];

/** Dollars with at least cents and up to four decimals, no trailing zeros: 20.35, 29.525. */
function money(n: number) {
  if (!Number.isFinite(n)) return "—";
  const [whole, frac = ""] = n.toFixed(4).replace(/0+$/, "").split(".");
  return `$${whole}.${frac.padEnd(2, "0")}`;
}

/** Which settings this page owns: this profile's, or all profiles' (the design's two scope tags). */
function Scope({ kind }: { kind: "profile" | "all" | "profile-only" }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center rounded-full border px-2.5 text-[11.5px] font-medium",
        kind === "all" ? "border-info/30 bg-info-soft text-info" : "border-volt-line bg-volt-soft text-primary"
      )}
    >
      {kind === "all" ? "All profiles" : kind === "profile-only" ? "This profile only" : "This profile"}
    </span>
  );
}

function NumberField({
  id,
  label,
  help,
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  min,
  max,
}: {
  id: string;
  label: string;
  help?: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </Label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-3">{prefix}</span>}
        <Input
          id={id}
          type="number"
          step={step}
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className={cn("max-md:h-11", prefix ? "pl-7" : suffix ? "pr-12" : undefined)}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-text-3">{suffix}</span>}
      </div>
    </div>
  );
}

export function ProfileSettingsForm({ profileId }: { profileId: string }) {
  const { profiles, currentProfileId, setCurrentProfileId, loading: profilesLoading, refresh: refreshProfiles } = useProfile();
  const profile = profiles.find((p) => p._id === profileId);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    getSettings(profileId)
      .then(({ settings }) => {
        setSaved(settings);
        setDraft(settings);
      })
      .catch(() => toast.error("Failed to load settings"));
  }, [profileId]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /** Switches that save the moment they are flipped: only their own field is written, so unsaved edits elsewhere on the page stay. */
  function commitKey<K extends keyof Draft>(key: K, value: Draft[K]) {
    setSaved((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleDefaultMutedChange(checked: boolean) {
    // "muted" means notifications OFF, so the switch label is inverted from defaultMuted.
    const defaultMuted = !checked;
    set("defaultMuted", defaultMuted);
    try {
      const { settings } = await updateSettings(profileId, { defaultMuted });
      commitKey("defaultMuted", settings.defaultMuted);
      toast.success(`Notifications are now ${defaultMuted ? "off" : "on"} by default for new traders`);
    } catch {
      set("defaultMuted", !defaultMuted);
      toast.error("Failed to update settings");
    }
  }

  async function handleTradingPausedChange(checked: boolean) {
    set("tradingPaused", checked);
    try {
      const { settings } = await updateSettings(profileId, { tradingPaused: checked });
      commitKey("tradingPaused", settings.tradingPaused);
      toast.success(checked ? "Trading paused - no new buys anywhere" : "Trading resumed");
    } catch {
      set("tradingPaused", !checked);
      toast.error("Failed to change the kill switch");
    }
  }

  const changedCount = draft && saved ? (Object.keys(draft) as (keyof Draft)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k])).length : 0;
  const dirty = changedCount > 0;

  async function handleResetAll() {
    setResetting(true);
    try {
      const { reset } = await resetAllTraders(profileId);
      toast.success(`Reset ${reset.length} trader${reset.length === 1 ? "" : "s"} back to their starting balance`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset traders");
    } finally {
      setResetting(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const { settings } = await updateSettings(profileId, draft);
      setSaved(settings);
      setDraft(settings);
      toast.success("Simulation defaults saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleRename() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (!profile || !trimmed || trimmed === profile.name) return;
    try {
      await renameProfile(profileId, trimmed);
      await refreshProfiles();
      toast.success("Profile renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename profile");
    }
  }

  if (!profile && !profilesLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        <Link href="/profiles" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
          <ChevronLeft className="size-3.5" /> Back to profiles
        </Link>
        <div role="alert" className="rounded-[14px] border border-destructive/30 bg-neg-soft p-5 text-sm text-[#ffc9d0]">
          Profile not found.
        </div>
      </div>
    );
  }

  if (!draft || !saved || !profile) {
    return (
      <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-48 w-full rounded-[20px]" />
        <Skeleton className="h-48 w-full rounded-[20px]" />
      </div>
    );
  }

  const pump = draft.defaultPumpFeePercent;
  const jito = draft.defaultJitoFeeUsd;
  const exampleBuy = 20 * (1 + pump / 100) + jito;
  const exampleSale = 30 * (1 - pump / 100) - jito;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <Link href="/profiles" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Back to profiles
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] md:text-[28px] md:leading-[34px]">
            Profile settings
            <HelpTip>These rules apply to every trader on this profile unless a trader overrides them.</HelpTip>
          </h1>
          {editingName ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              aria-label="Profile name"
              className="h-9 w-56"
            />
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex h-[22px] max-w-[220px] items-center gap-1.5 rounded-full border border-volt-line bg-volt-soft px-2.5 text-[11.5px] font-medium text-primary">
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                <span className="truncate">{profile.name}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Rename profile"
                title="Click to rename"
                className="max-md:size-9"
                onClick={() => {
                  setNameDraft(profile.name);
                  setEditingName(true);
                }}
              >
                <Pencil />
              </Button>
            </span>
          )}
        </div>
        {profile._id !== currentProfileId && (
          <Button variant="outline" onClick={() => setCurrentProfileId(profile._id)}>
            Switch to this profile
          </Button>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8">
        <SectionNav items={SECTIONS} />

        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <Section id="set-capital" icon={Wallet} title="Capital" scope={<Scope kind="profile" />}>
            <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
              <NumberField
                id="allocation"
                label="Starting allocation"
                prefix="$"
                step={10}
                min={0}
                value={draft.defaultAllocationUsd}
                onChange={(v) => set("defaultAllocationUsd", v)}
                help="Paper capital a new trader starts with. Applies only at first init - an existing trader's balance isn't rewritten."
              />
              <NumberField
                id="tradeSize"
                label="Trade size"
                prefix="$"
                step={5}
                min={0}
                value={draft.defaultTradeSizeUsd}
                onChange={(v) => set("defaultTradeSizeUsd", v)}
                help="USD spent per simulated buy, regardless of the trader's size."
              />
            </div>
          </Section>

          <Section id="set-filters" icon={Filter} title="Buy filters" subtitle="Avoid mirroring trades that aren't real signal" scope={<Scope kind="profile" />}>
            <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
              <NumberField
                id="dustBuy"
                label="Dust-buy threshold"
                prefix="$"
                step={5}
                min={0}
                value={draft.defaultDustBuyUsd}
                onChange={(v) => set("defaultDustBuyUsd", v)}
                help="Ignore a buy below this USD value. A mint is only ever bought (or skipped) once."
              />
              <NumberField
                id="dustSell"
                label="Dust-sell fraction"
                suffix="%"
                step={1}
                min={0}
                value={draft.defaultDustSellFractionPercent}
                onChange={(v) => set("defaultDustSellFractionPercent", v)}
                help="Ignore a sell smaller than this % of the trader's bought amount. A full exit still counts."
              />
            </div>
          </Section>

          <Section id="set-risk" icon={ShieldAlert} title="Risk exits" scope={<Scope kind="profile" />}>
            <div className="grid gap-4 md:grid-cols-2 md:gap-5">
              <div className="flex flex-col gap-3">
                <ToggleRow title="Stop-loss" status={draft.defaultStopLossPercent !== null ? "On" : "Off"}>
                  <Switch aria-label="Stop-loss" checked={draft.defaultStopLossPercent !== null} onCheckedChange={(checked) => set("defaultStopLossPercent", checked ? 60 : null)} />
                </ToggleRow>
                {draft.defaultStopLossPercent !== null && (
                  <NumberField
                    id="stopLoss"
                    label="Stop-loss level"
                    suffix="%"
                    step={5}
                    min={1}
                    value={draft.defaultStopLossPercent}
                    onChange={(v) => set("defaultStopLossPercent", v)}
                    help="Force-close at this % unrealized loss. 60 = down 60% from cost."
                  />
                )}
              </div>
              <div className="flex flex-col gap-3">
                <ToggleRow title="Take-profit" status={draft.defaultTakeProfitPercent !== null ? "On" : "Off"}>
                  <Switch aria-label="Take-profit" checked={draft.defaultTakeProfitPercent !== null} onCheckedChange={(checked) => set("defaultTakeProfitPercent", checked ? 80 : null)} />
                </ToggleRow>
                {draft.defaultTakeProfitPercent !== null && (
                  <NumberField
                    id="takeProfit"
                    label="Take-profit level"
                    suffix="%"
                    step={5}
                    min={1}
                    value={draft.defaultTakeProfitPercent}
                    onChange={(v) => set("defaultTakeProfitPercent", v)}
                    help="Force-close at this % unrealized gain. 80 = up 80% from cost."
                  />
                )}
              </div>
            </div>

            <div className="grid items-start gap-4 md:grid-cols-2 md:gap-5">
              <NumberField
                id="maxTradeTime"
                label="Max trade time"
                suffix="min"
                step={5}
                min={0}
                value={draft.defaultMaxTradeTimeSeconds / 60}
                onChange={(v) => set("defaultMaxTradeTimeSeconds", Math.max(0, v) * 60)}
                help="0 = no limit. 30 force-sells after 30 minutes if the trader still hasn't sold."
              />
              <ToggleRow title="Allow negative balance">
                <Switch aria-label="Allow negative balance" checked={draft.defaultAllowNegativeBalance} onCheckedChange={(checked) => set("defaultAllowNegativeBalance", checked)} />
              </ToggleRow>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-info/30 bg-info-soft px-3 py-2.5 text-xs leading-[18px] text-[#c7e2ff]">
              <Info className="mt-px size-3.5 shrink-0 text-info" />
              {draft.defaultAllowNegativeBalance
                ? "On: a trader can keep buying past $0 into debt, tracked separately."
                : "Off: a buy is skipped entirely once the balance can't cover the trade size."}
            </div>
          </Section>

          <Section
            icon={Waves}
            title="Trailing stops"
            help={'Once a position reaches "arm at" it auto-sells if it falls back to "exit at" (can be negative). Whichever rule triggers first closes the position.'}
            scope={<Scope kind="profile" />}
          >
            <TrailingStopsEditor value={draft.defaultTrailingStops} onChange={(next) => set("defaultTrailingStops", next)} />
          </Section>

          <Section id="set-execution" icon={Timer} title="Execution & fees" subtitle="Models the latency and costs of a real trade" scope={<Scope kind="profile" />}>
            <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
              <NumberField
                id="delay"
                label="Execution delay"
                suffix="sec"
                step={0.5}
                min={0}
                value={draft.defaultExecutionDelaySeconds}
                onChange={(v) => set("defaultExecutionDelaySeconds", v)}
                help="Simulated latency between detecting a trade and filling our order."
              />
              <div className="hidden sm:block" />
              <NumberField
                id="pumpFee"
                label="Pump fee"
                suffix="%"
                step={0.05}
                min={0}
                max={2}
                value={draft.defaultPumpFeePercent}
                onChange={(v) => set("defaultPumpFeePercent", v)}
                help="pump.fun's on-chain fee (0.95% protocol + 0.30% creator) on every buy and sell. Max 2%."
              />
              <NumberField
                id="jitoFee"
                label="Jito fee per transaction"
                prefix="$"
                step={0.01}
                min={0}
                max={1}
                value={draft.defaultJitoFeeUsd}
                onChange={(v) => set("defaultJitoFeeUsd", v)}
                help="Flat USD per transaction (Jito tip + priority fee) on every buy and sell. Max $1."
              />
            </div>
            <div className="rounded-xl border border-border bg-surface-2 px-3.5 py-3">
              <span className="text-xs text-text-3">Worked example</span>
              <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                <span>
                  $20 buy @ {Number.isFinite(pump) ? pump : "—"}% + {money(jito)} Jito = <b className="font-semibold tabular-nums">{money(exampleBuy)}</b>
                </span>
                <span>
                  $30 sale nets <b className="font-semibold tabular-nums">{money(exampleSale)}</b>
                </span>
              </div>
            </div>
          </Section>

          <Section icon={Activity} title="Polling & pricing" tone="info" scope={<Scope kind="all" />}>
            <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
              <NumberField
                id="riskCheckInterval"
                label="Price check interval"
                suffix="sec"
                step={5}
                min={5}
                value={draft.riskCheckIntervalSeconds}
                onChange={(v) => set("riskCheckIntervalSeconds", v)}
                help="How often every open position is re-priced and checked for stop-loss and take-profit. Minimum 5 s."
              />
              <NumberField
                id="apiPollsPerSecond"
                label="API polls per second (each trader)"
                suffix="/sec"
                step={0.5}
                min={0.2}
                value={draft.apiPollsPerSecond}
                onChange={(v) => set("apiPollsPerSecond", v)}
                help="How often each trader is asked for new trades by the pump.fun API (min 0.2 s). The proxy pool caps the real rate."
              />
            </div>
          </Section>

          <section id="set-trading" className={cn("scroll-mt-24 overflow-hidden rounded-[20px] border bg-card", draft.tradingPaused ? "border-destructive/40" : "border-border")}>
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5 md:py-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-[10px]", draft.tradingPaused ? "bg-neg-soft text-negative" : "bg-surface-3 text-primary")}>
                  <ShieldAlert className="size-4" />
                </span>
                <h2 className="text-[15px] font-semibold">
                  Kill switch
                  <HelpTip>Stops every new buy right away. Sells and exits keep working, so open positions can still be closed.</HelpTip>
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-text-3 sm:inline">saves instantly</span>
                <Scope kind="all" />
              </div>
            </div>
            <div className="p-4 md:p-5">
              <ToggleRow
                danger={!!draft.tradingPaused}
                title="Pause all new buys"
                status={draft.tradingPaused ? "PAUSED — no new position will be opened anywhere until you turn this off." : "Off — trading normally."}
                statusTone={draft.tradingPaused ? "negative" : undefined}
              >
                <Switch aria-label="Pause all new buys" checked={!!draft.tradingPaused} onCheckedChange={handleTradingPausedChange} className="data-checked:border-negative data-checked:bg-negative" />
              </ToggleRow>
            </div>
          </section>

          <Section
            id="set-notify"
            icon={draft.defaultMuted ? BellOff : BellRing}
            title="Notifications"
            help="Whether a newly added trader is notified by default. Any trader can override this on its own page."
            tone="info"
            scope={<Scope kind="all" />}
          >
            <ToggleRow title="Notify on new trades by default" status={draft.defaultMuted ? "Currently off — new traders start muted." : "Currently on — new traders start unmuted."}>
              <Switch aria-label="Notify on new trades by default" checked={!draft.defaultMuted} onCheckedChange={handleDefaultMutedChange} />
            </ToggleRow>
          </Section>

          <Section id="set-danger" icon={TriangleAlert} title="Danger zone" tone="danger" scope={<Scope kind="profile-only" />}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <b className="text-[13px] font-semibold">Reset all traders&apos; simulations</b>
                <span className="max-w-[520px] text-xs text-text-3">Resets every active trader&apos;s positions, history and P&amp;L to a fresh start, in this profile only.</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="lg" disabled={resetting} className="gap-1.5 md:h-9 md:rounded-[10px] md:px-3.5 md:text-[13px]">
                    <RotateCcw className="size-3.5" />
                    Reset all…
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset every active trader&apos;s simulation in this profile?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Resets every active trader&apos;s positions, history and P&amp;L to a fresh start, in this profile only. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={handleResetAll}>
                      Reset all traders
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Section>
        </div>
      </div>

      {/* Appears with the first unsaved edit; the kill switch and notifications save on their own. */}
      {dirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-[68px] z-20 -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line-2 bg-[rgba(10,14,11,0.94)] px-4 py-3.5 backdrop-blur-md md:bottom-0 md:-mx-6 md:-mb-8 md:px-6 lg:-mx-8 lg:px-8"
        >
          <span className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-warn" />
            {changedCount} unsaved change{changedCount === 1 ? "" : "s"}
            <span className="text-xs text-text-3 max-md:hidden">· kill switch and notifications save instantly</span>
          </span>
          <div className="flex gap-2 max-md:w-full">
            <Button variant="ghost" size="lg" className="md:h-9 md:text-[13px]" onClick={() => setDraft(saved)} disabled={saving}>
              Discard
            </Button>
            <Button size="lg" className="max-md:flex-1 md:h-9 md:rounded-[10px] md:text-[13px]" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : `Save ${changedCount > 1 ? `${changedCount} changes` : "changes"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
