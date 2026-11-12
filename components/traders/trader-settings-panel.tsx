"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Info, RotateCcw, Timer, TriangleAlert, Waves, Wallet, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { resetTrader, updateTraderSettings } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { cn } from "@/lib/utils";
import type { EffectiveSettings, TraderDetail, TraderSimSettings, TrailingStop } from "@/lib/types";
import { TrailingStopsEditor } from "@/components/trailing-stops-editor";

type Props = {
  address: string;
  settings: TraderSimSettings;
  effectiveSettings: EffectiveSettings;
  onUpdated: (next: { settings: TraderSimSettings; effectiveSettings: EffectiveSettings }) => void;
  onReset?: (trader: TraderDetail) => void;
};

/** "Profile default" / "Overridden" tag on the right of a field's label. */
function SourceBadge({ overridden }: { overridden: boolean }) {
  return overridden ? (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-volt-line bg-volt-soft px-2 text-[11.5px] font-medium text-primary">
      <span className="size-[7px] rounded-full bg-primary shadow-[0_0_0_3px_var(--volt-soft)]" />
      Overridden
    </span>
  ) : (
    <span className="inline-flex h-[22px] items-center rounded-full border border-line-2 bg-surface-3 px-2 text-[11.5px] font-medium text-text-2">Profile default</span>
  );
}

function OverrideField({
  id,
  label,
  help,
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
  help: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const isOverridden = override !== null;

  function commit() {
    if (draft === "") {
      if (isOverridden) onClear(); // emptying an overridden field goes back to the profile default
      return;
    }
    const num = Number(draft);
    if (!Number.isFinite(num)) {
      setDraft(override !== null ? String(override) : "");
      return;
    }
    if (num !== override) onSave(num);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>
          {label}
          <HelpTip>{help}</HelpTip>
        </Label>
        <SourceBadge overridden={isOverridden} />
      </div>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-3">{prefix}</span>}
        <Input
          ref={inputRef}
          id={id}
          type="number"
          step={step}
          min={min}
          placeholder={String(effective)}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className={cn(prefix && "pl-7", suffix && "pr-11", isOverridden ? "border-primary" : "placeholder:text-text-3")}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-text-3">{suffix}</span>}
      </div>
      <div className="flex items-center justify-between">
        {isOverridden ? (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onClear();
            }}
            className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-text-2 hover:text-primary"
          >
            <RotateCcw className="size-3" /> Reset to default
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(String(effective));
              inputRef.current?.focus();
            }}
            className="inline-flex min-h-6 items-center text-xs font-medium text-primary hover:text-[var(--volt-hover)]"
          >
            Override
          </button>
        )}
      </div>
    </div>
  );
}

/** A switch row: the stop-loss / take-profit / negative-balance style of setting. */
function ToggleRow({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
      <div className="flex min-w-0 flex-col">
        <b className="text-[13px] font-semibold">{title}</b>
        <span className="text-xs text-text-3">{status}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">{children}</div>
    </div>
  );
}

function PercentInput({ defaultValue, onCommit, label }: { defaultValue: number | null; onCommit: (n: number) => void; label: string }) {
  return (
    <div className="relative w-24">
      <Input
        type="number"
        step={5}
        min={1}
        aria-label={label}
        className="h-9 rounded-lg border-primary pr-7 text-[13px] md:text-[13px]"
        defaultValue={defaultValue ?? undefined}
        onBlur={(e) => {
          const num = Number(e.target.value);
          if (Number.isFinite(num) && num !== defaultValue) onCommit(num);
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-text-3">%</span>
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
    <section id="settings-trailing" className="scroll-mt-24 overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5 md:py-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Waves className="size-4 text-primary" /> Trailing stops
        </h3>
        <div className="flex items-center gap-2.5">
          <SourceBadge overridden={isOverridden} />
          <Switch
            aria-label="Override trailing stops"
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
      </div>
      <div className="flex flex-col gap-3 p-4 md:p-5">
        {!isOverridden && <span className="text-xs text-text-3">Inherited from the profile ({effective.length} rule{effective.length === 1 ? "" : "s"}). Turn the switch on to set your own for this trader.</span>}
        <div className={cn(!isOverridden && "opacity-60")}>
          <TrailingStopsEditor
            value={draft}
            onChange={setDraft}
            disabled={!isOverridden}
            actions={
              isOverridden && dirty ? (
                <>
                  <Button size="sm" onClick={() => onSave(draft)}>
                    Save rules
                  </Button>
                  <span className="text-xs text-warn">unsaved edits</span>
                </>
              ) : null
            }
          />
        </div>
      </div>
    </section>
  );
}

function SectionCard({ id, icon: Icon, title, children, danger }: { id: string; icon: typeof Wallet; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section id={id} className={cn("scroll-mt-24 overflow-hidden rounded-[20px] border bg-card", danger ? "border-destructive/35" : "border-border")}>
      <div className="border-b border-border px-4 py-3.5 md:px-5 md:py-4">
        <h3 className={cn("flex items-center gap-2 text-[15px] font-semibold", danger && "text-negative")}>
          <Icon className={cn("size-4", danger ? "text-negative" : "text-primary")} /> {title}
        </h3>
      </div>
      <div className="flex flex-col gap-5 p-4 md:p-5">{children}</div>
    </section>
  );
}

const SECTIONS = [
  { id: "settings-capital", label: "Capital", icon: Wallet },
  { id: "settings-filters", label: "Buy / sell filters", icon: Filter },
  { id: "settings-risk", label: "Risk exits", icon: TriangleAlert },
  { id: "settings-execution", label: "Execution & fees", icon: Timer },
  { id: "settings-danger", label: "Danger zone", icon: TriangleAlert, danger: true },
] as const;

export function TraderSettingsPanel({ address, settings, effectiveSettings, onUpdated, onReset }: Props) {
  const { currentProfileId, currentProfile } = useProfile();
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  async function save(patch: Partial<TraderSimSettings>) {
    if (!currentProfileId) return;
    try {
      const result = await updateTraderSettings(currentProfileId, address, patch);
      onUpdated(result);
      toast.success("Trader setting updated");
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
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

  function goTo(id: string) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const stopLossOverridden = settings.stopLossPercent !== null;
  const takeProfitOverridden = settings.takeProfitPercent !== null;
  const negBalanceOverridden = settings.allowNegativeBalance !== null;
  const profileName = currentProfile?.name ?? "the profile";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-[14px] border border-info/30 bg-info-soft px-4 py-3 text-[13px] leading-5 text-[#c7e2ff]">
        <Info className="size-4 shrink-0 text-info" />
        <span className="min-w-0 flex-1">
          Everything inherits from <b>{profileName}</b> until you override it. Each field saves as you leave it.
        </span>
        {saved && (
          <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-positive/30 bg-pos-soft px-2 text-[11.5px] font-medium text-positive max-sm:hidden">
            <Check className="size-3" /> Trader setting updated
          </span>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[220px_1fr] lg:gap-8">
        {/* Section links: a sticky list beside the cards on wide screens, a row of chips on phones. */}
        <nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto max-lg:-mx-4 max-lg:px-4 lg:sticky lg:top-24 lg:flex-col lg:gap-0.5 lg:overflow-visible">
          {SECTIONS.map((s) => {
            const danger = "danger" in s && s.danger;
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(s.id)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2.5 rounded-full border px-4 text-sm whitespace-nowrap transition-colors lg:h-[38px] lg:rounded-[10px] lg:border-transparent lg:px-3",
                  active ? "border-volt-line bg-volt-soft text-primary lg:bg-surface-3 lg:text-foreground" : "border-line-2 bg-card text-text-2 hover:text-foreground lg:bg-transparent",
                  danger && "text-negative hover:text-negative"
                )}
              >
                <s.icon className={cn("size-4", active && !danger && "lg:text-primary")} />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard id="settings-capital" icon={Wallet} title="Capital">
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
              help="Only takes effect before this trader's balance has been initialized."
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
              help="USD spent per simulated buy for this trader."
            />
          </SectionCard>

          <SectionCard id="settings-filters" icon={Filter} title="Buy / sell filters">
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
              help="Ignore this trader's buys below this USD value."
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
              help="Ignore a sell under this % of their total bought amount."
            />
          </SectionCard>

          <SectionCard id="settings-risk" icon={TriangleAlert} title="Risk exits">
            <ToggleRow
              title="Stop-loss"
              status={
                stopLossOverridden
                  ? "Overridden for this trader"
                  : effectiveSettings.stopLossPercent !== null
                    ? `Inherited from profile: ${effectiveSettings.stopLossPercent}%`
                    : "Inherited from profile: disabled"
              }
            >
              {stopLossOverridden && <PercentInput label="Stop-loss percent" defaultValue={settings.stopLossPercent} onCommit={(n) => save({ stopLossPercent: n })} />}
              <Switch aria-label="Override stop-loss" checked={stopLossOverridden} onCheckedChange={(checked) => save({ stopLossPercent: checked ? (effectiveSettings.stopLossPercent ?? 60) : null })} />
            </ToggleRow>

            <ToggleRow
              title="Take-profit"
              status={
                takeProfitOverridden
                  ? "Overridden for this trader"
                  : effectiveSettings.takeProfitPercent !== null
                    ? `Inherited from profile: ${effectiveSettings.takeProfitPercent}%`
                    : "Inherited from profile: disabled"
              }
            >
              {takeProfitOverridden && <PercentInput label="Take-profit percent" defaultValue={settings.takeProfitPercent} onCommit={(n) => save({ takeProfitPercent: n })} />}
              <Switch aria-label="Override take-profit" checked={takeProfitOverridden} onCheckedChange={(checked) => save({ takeProfitPercent: checked ? (effectiveSettings.takeProfitPercent ?? 80) : null })} />
            </ToggleRow>

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
              help="0 = no limit. e.g. 30 force-sells after 30 minutes if the trader still hasn't sold."
            />

            <ToggleRow title="Allow negative balance" status={`${negBalanceOverridden ? "Overridden" : "Inherited from profile"} — ${effectiveSettings.allowNegativeBalance ? "on" : "off"}`}>
              <Switch aria-label="Allow negative balance" checked={effectiveSettings.allowNegativeBalance} onCheckedChange={(checked) => save({ allowNegativeBalance: checked })} />
              {negBalanceOverridden && (
                <Button variant="ghost" size="icon-sm" onClick={() => save({ allowNegativeBalance: null })} aria-label="Reset to profile default" title="Reset to profile default">
                  <RotateCcw />
                </Button>
              )}
            </ToggleRow>
          </SectionCard>

          <TrailingStopsOverride override={settings.trailingStops} effective={effectiveSettings.trailingStops} onSave={(rules) => save({ trailingStops: rules })} onClear={() => save({ trailingStops: null })} />

          <SectionCard id="settings-execution" icon={Timer} title="Execution & fees">
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
              help="Simulated latency before our fill, for this trader."
            />
            <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
              <OverrideField
                id="ov-pumpFee"
                label="Pump fee"
                suffix="%"
                step={0.05}
                min={0}
                override={settings.pumpFeePercent ?? null}
                effective={effectiveSettings.pumpFeePercent}
                onSave={(v) => save({ pumpFeePercent: v })}
                onClear={() => save({ pumpFeePercent: null })}
                help="% of trade value, charged on every buy and sell for this trader."
              />
              <OverrideField
                id="ov-jitoFee"
                label="Jito fee per transaction"
                prefix="$"
                step={0.01}
                min={0}
                override={settings.jitoFeeUsd ?? null}
                effective={effectiveSettings.jitoFeeUsd}
                onSave={(v) => save({ jitoFeeUsd: v })}
                onClear={() => save({ jitoFeeUsd: null })}
                help="Flat USD per buy and per sell for this trader."
              />
            </div>
          </SectionCard>

          <SectionCard id="settings-danger" icon={TriangleAlert} title="Danger zone" danger>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <b className="text-[13px] font-semibold">Reset simulation</b>
                <span className="text-xs text-text-3">Wipes this trader&apos;s positions and trade history; balance returns to the starting allocation.</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={resetting}>
                    Reset…
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogMedia className="bg-neg-soft text-negative">
                      <RotateCcw />
                    </AlertDialogMedia>
                    <AlertDialogTitle>Reset this trader&apos;s simulation?</AlertDialogTitle>
                    <AlertDialogDescription>Resets positions, trade history and P&amp;L to the starting balance. This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset} className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90">
                      Reset
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
