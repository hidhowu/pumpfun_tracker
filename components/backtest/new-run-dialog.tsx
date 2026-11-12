"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsList, SettingsRow } from "@/components/ui/settings-row";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/use-media-query";
import { DialogHead, Field, Group, Notice } from "./dialog-parts";
import { createBacktestRun, getBacktestSettings } from "@/lib/backtest-api";
import { getSettings } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import type { BacktestStrategy } from "@/lib/backtest-types";
import { StrategyChips } from "./shared";
import { ScreeningFields, parseScreening, type ScreeningValues } from "./screening-fields";
import { TimingFields, parseTiming, toTimingValues, type TimingValues } from "./timing-fields";
import { CombinedFields, parseCombined, toCombinedValues, type CombinedValues } from "./combined-fields";
import { cn } from "@/lib/utils";

const PRESETS = [3, 7, 12, 30].map((d) => ({ value: String(d), label: `${d}d` }));
const STYLES = [
  { value: "separate", label: "Separate wallets" },
  { value: "combined", label: "Combined wallet" },
] as const;
const METHODS = [
  { value: "api", label: "API (fast)" },
  { value: "rpc", label: "RPC (slow, long history)" },
] as const;
const DEFAULT_MAX_SIGNATURES = 50_000;
// pump.fun's user-trades API only keeps about this many days of a wallet's history; beyond it the chain (RPC) is the way.
const API_HISTORY_DAYS = 60;
const MAX_DAYS = 120;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  /** How many addresses are on the backtest list. "All on the list" is resolved by the server, so the list itself is never loaded here. */
  allCount: number;
  onCreated: (runId: string) => void;
};

/**
 * Creates a backtest: how many days back, which profile's settings to follow
 * (frozen into the run), and which addresses. The profile's strategy is
 * previewed here so there is no surprise about what will be simulated.
 */
export function NewRunDialog({ open, onOpenChange, selected, allCount, onCreated }: Props) {
  const { profiles, currentProfileId } = useProfile();
  const phone = !useMediaQuery("(min-width: 640px)");
  const [name, setName] = useState("");
  const [days, setDays] = useState("7");
  const [maxSignatures, setMaxSignatures] = useState(String(DEFAULT_MAX_SIGNATURES));
  const [collectMethod, setCollectMethod] = useState<"api" | "rpc">("api");
  const [profileId, setProfileId] = useState<string>("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [submitting, setSubmitting] = useState(false);
  const [strategy, setStrategy] = useState<BacktestStrategy | null>(null);
  const [timing, setTiming] = useState<TimingValues | null>(null);
  const [screening, setScreening] = useState<ScreeningValues>({ addressParallelism: "", daysAtOnce: "0", lossDays: "0", dayLossPercent: "0", negativeBalanceEvents: "0", lossAtProgressPercent: "0" });
  const [autoParallelism, setAutoParallelism] = useState<number | undefined>();
  // "combined": every address trades as one wallet with one shared balance (see db/backtest/combined.js). Its numbers start from the profile.
  const [mode, setMode] = useState<"separate" | "combined">("separate");
  const [combined, setCombined] = useState<CombinedValues | null>(null);

  // Each time the dialog opens: default to the selection if there is one, else everything, and to the profile currently in use.
  useEffect(() => {
    if (!open) return;
    setScope(selected.length > 0 ? "selected" : "all");
    setProfileId((prev) => prev || currentProfileId || profiles[0]?._id || "");
  }, [open, selected.length, currentProfileId, profiles]);

  // Preview the chosen profile's settings (the same defaults the backtest will freeze).
  useEffect(() => {
    if (!open || !profileId) return;
    let cancelled = false;
    // The timing starts from what the profile / live system / backtest settings say, and can then be changed here before starting.
    Promise.all([getSettings(profileId), getBacktestSettings().catch(() => null)])
      .then(([{ settings }, backtest]) => {
        if (cancelled) return;
        setAutoParallelism(backtest?.effective.addressParallelism);
        setTiming(
          toTimingValues({
            executionDelaySeconds: settings.defaultExecutionDelaySeconds ?? 2,
            riskCheckIntervalSeconds: settings.riskCheckIntervalSeconds ?? 7,
            fillLatencySeconds: backtest?.effective.fillLatencySeconds ?? 3,
          })
        );
        setCombined(
          toCombinedValues({
            startingBalanceUsd: settings.defaultAllocationUsd,
            tradeSizeUsd: settings.defaultTradeSizeUsd,
            pumpFeePercent: settings.defaultPumpFeePercent ?? 1.25,
            jitoFeeUsd: settings.defaultJitoFeeUsd ?? 0,
            resetDaily: false,
            allowNegativeBalance: settings.defaultAllowNegativeBalance !== false,
          })
        );
        setStrategy({
          allocationUsd: settings.defaultAllocationUsd,
          tradeSizeUsd: settings.defaultTradeSizeUsd,
          dustBuyUsd: settings.defaultDustBuyUsd,
          dustSellFractionPercent: settings.defaultDustSellFractionPercent,
          stopLossPercent: settings.defaultStopLossPercent ?? null,
          takeProfitPercent: settings.defaultTakeProfitPercent ?? null,
          maxTradeTimeSeconds: settings.defaultMaxTradeTimeSeconds ?? 0,
          trailingStops: (settings.defaultTrailingStops ?? []).map((r) => ({ _id: String(r._id), armPercent: r.armPercent, exitPercent: r.exitPercent })),
          allowNegativeBalance: settings.defaultAllowNegativeBalance !== false,
          executionDelaySeconds: settings.defaultExecutionDelaySeconds ?? 2,
          pumpFeePercent: settings.defaultPumpFeePercent ?? 1.25,
          jitoFeeUsd: settings.defaultJitoFeeUsd ?? 0,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStrategy(null);
        setTiming(null);
        setCombined(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, profileId]);

  const addressCount = scope === "selected" ? selected.length : allCount;
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= MAX_DAYS;
  // Empty or 0 = no limit.
  const maxSignaturesNumber = maxSignatures === "" ? 0 : Number(maxSignatures);
  const maxSignaturesValid = Number.isInteger(maxSignaturesNumber) && maxSignaturesNumber >= 0;

  const timingNumbers = timing ? parseTiming(timing) : null;
  const screeningNumbers = parseScreening(screening);
  const isCombined = mode === "combined";
  const combinedNumbers = combined ? parseCombined(combined) : null;
  // What will really be simulated: the profile's strategy with the wallet's own trade amount and fees on top.
  const previewStrategy: BacktestStrategy | null =
    strategy && isCombined && combinedNumbers
      ? { ...strategy, allocationUsd: combinedNumbers.startingBalanceUsd, tradeSizeUsd: combinedNumbers.tradeSizeUsd, pumpFeePercent: combinedNumbers.pumpFeePercent, jitoFeeUsd: combinedNumbers.jitoFeeUsd }
      : strategy;

  async function handleSubmit() {
    if (!daysValid) {
      toast.error(`Days must be a whole number between 1 and ${MAX_DAYS}`);
      return;
    }
    if (!maxSignaturesValid) {
      toast.error("The signature limit must be a whole number (0 = no limit)");
      return;
    }
    if (!profileId) {
      toast.error("Choose a profile to follow");
      return;
    }
    if (timing && !timingNumbers) {
      toast.error("Check the timing settings - each must be a number in range");
      return;
    }
    if (!screeningNumbers) {
      toast.error("Check the speed and loss-trader settings - each must be a number in range");
      return;
    }
    if (isCombined && !combinedNumbers) {
      toast.error("Check the combined wallet settings - each must be a number in range");
      return;
    }
    if (addressCount === 0) {
      toast.error("No addresses to backtest");
      return;
    }
    setSubmitting(true);
    try {
      const { run, queuePosition } = await createBacktestRun({
        name: name.trim() || undefined,
        days: daysNumber,
        profileId,
        ...(scope === "all" ? { allAddresses: true } : { addresses: selected }),
        maxSignatures: maxSignaturesNumber,
        collectMethod,
        overrides: {
          ...(timingNumbers ?? {}),
          ...(isCombined && combinedNumbers ? { tradeSizeUsd: combinedNumbers.tradeSizeUsd, pumpFeePercent: combinedNumbers.pumpFeePercent, jitoFeeUsd: combinedNumbers.jitoFeeUsd } : {}),
        },
        earlyStop: screeningNumbers.earlyStop,
        addressParallelism: screeningNumbers.addressParallelism,
        daysAtOnce: screeningNumbers.daysAtOnce,
        ...(isCombined && combinedNumbers
          ? { mode: "combined" as const, combined: { startingBalanceUsd: combinedNumbers.startingBalanceUsd, resetDaily: combinedNumbers.resetDaily, allowNegativeBalance: combinedNumbers.allowNegativeBalance } }
          : {}),
      });
      const count = `${addressCount.toLocaleString()} address${addressCount === 1 ? "" : "es"}`;
      // Backtests are worked one at a time: the new one starts at once if nothing else is running, otherwise it waits its turn.
      toast.success(queuePosition && queuePosition > 0 ? `Backtest on ${count} queued - ${queuePosition} ahead of it, it starts by itself when they finish` : `Backtest started on ${count}`);
      onOpenChange(false);
      onCreated(run._id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start the backtest");
    } finally {
      setSubmitting(false);
    }
  }

  const scopeOptions = [
    { value: "selected", label: `Selected (${selected.length})` },
    { value: "all", label: `All on the list (${allCount.toLocaleString()})` },
  ] as const;
  const timingSummary =timingNumbers ? `Delay ${timingNumbers.executionDelaySeconds}s · checks ${timingNumbers.riskCheckIntervalSeconds}s · +${timingNumbers.fillLatencySeconds}s` : undefined;
  const speedSummary = `Addresses at once ${screening.addressParallelism || (autoParallelism ? `auto (${autoParallelism})` : "auto")} · days at once ${screening.daysAtOnce || 0} · signature limit ${maxSignaturesNumber ? maxSignaturesNumber.toLocaleString() : "none"}`;
  const combinedSummary = combinedNumbers ? `$${combinedNumbers.startingBalanceUsd} start · $${combinedNumbers.tradeSizeUsd}/trade · ${combinedNumbers.pumpFeePercent}% + $${combinedNumbers.jitoFeeUsd}` : undefined;

  const addressesField = (
    <Field label="Addresses">
      <Segmented options={scopeOptions} value={scope} onChange={setScope} label="Addresses" block tall />
    </Field>
  );

  const signatureRow = (
    <SettingsList>
      <SettingsRow label="Skip addresses with more signatures than" help="Skips an address with more trades than this in the window (signatures, if read over RPC). 0 = no limit." htmlFor="bt-max-signatures">
        <Input
          id="bt-max-signatures"
          inputMode="numeric"
          value={maxSignatures}
          onChange={(e) => setMaxSignatures(e.target.value.replace(/[^0-9]/g, ""))}
          className={cn("w-[140px] text-right", !maxSignaturesValid && "border-negative")}
          aria-invalid={!maxSignaturesValid}
        />
      </SettingsRow>
    </SettingsList>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHead
          icon={<FlaskConical className="size-5" />}
          title="New backtest"
          help="Replays each address's recent trades against real pool history, using the chosen profile's settings. Anything already collected for an address is reused."
          description="Choose the window, the profile to follow and the addresses to replay."
        />

        <div className="flex flex-col gap-4">
          <Field
            label="Backtest style"
            help={mode === "combined" ? "All addresses trade as ONE wallet, with a shared balance and trade amount, added up in the order the trades happened." : "Each address gets its own wallet, so you can compare them and drop the weak ones."}
          >
            <Segmented options={STYLES} value={mode} onChange={setMode} label="Backtest style" block tall />
          </Field>

          <Field label="Name" optional htmlFor="bt-name">
            <Input id="bt-name" placeholder={`${daysValid ? daysNumber : "7"}-day backtest`} value={name} onChange={(e) => setName(e.target.value)} className="max-md:h-11" />
          </Field>

          <Field label="Days back from now" htmlFor="bt-days">
            <div className="flex items-center gap-2">
              <Segmented options={PRESETS} value={String(daysNumber)} onChange={setDays} label="Days back" className="min-w-0 flex-1 sm:flex-none" block={phone} tall />
              <div className="relative w-[110px] shrink-0">
                <Input
                  id="bt-days"
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))}
                  className={cn("pr-12 max-md:h-11", !daysValid && days !== "" && "border-negative")}
                  aria-invalid={!daysValid}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-text-3">days</span>
              </div>
            </div>
          </Field>

          <Field
            label="How to read the trades"
            help={
              collectMethod === "rpc"
                ? "Lists each address's transactions over RPC and reads the pump.fun trades out of them. Much slower and uses a lot of requests, but reaches as far back as the RPC keeps history."
                : "Uses pump.fun's API: a few dozen requests per address, so much faster, but it keeps only about 60 days of history. Use RPC for longer."
            }
          >
            <Segmented options={METHODS} value={collectMethod} onChange={setCollectMethod} label="How to read the trades" block tall />
          </Field>
          {collectMethod === "api" && daysValid && daysNumber > API_HISTORY_DAYS && (
            <Notice>{daysNumber} days is more than pump.fun keeps - the oldest part of the window would be missing. Switch to RPC to cover it.</Notice>
          )}

          {!phone && signatureRow}

          <Field label="Follow the settings of" help="Copied when you start - editing the profile later never changes this backtest." htmlFor="bt-profile">
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="bt-profile" className="w-full max-md:h-11">
                <SelectValue placeholder="Choose a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                    {p.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {previewStrategy ? <StrategyChips settings={previewStrategy} /> : <p className="text-xs text-text-3">Loading the profile&apos;s settings…</p>}
          </Field>

          {phone && addressesField}

          {isCombined && combined && (
            <Group title="Combined wallet and fees" summary={combinedSummary} note="Filled in from the profile. Change the balance, the trade amount or the fees to see what result you would get.">
              <CombinedFields values={combined} onChange={setCombined} />
            </Group>
          )}

          {timing && (
            <Group title="Timing" summary={timingSummary} note="Filled in from the profile and live settings so the backtest behaves like a live run. Change them to test a different setup.">
              <TimingFields values={timing} onChange={setTiming} />
            </Group>
          )}

          <Group
            title={isCombined ? "Speed" : "Speed and loss traders"}
            summary={speedSummary}
            note={isCombined ? "There are no loss-trader rules in a combined backtest: dropping one address would change the wallet the others share." : undefined}
          >
            <ScreeningFields values={screening} onChange={setScreening} autoParallelism={autoParallelism} speedOnly={isCombined} />
            {phone && signatureRow}
          </Group>

          {!phone && addressesField}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || addressCount === 0 || !daysValid || !maxSignaturesValid || !screeningNumbers || (timing !== null && !timingNumbers) || (isCombined && !combinedNumbers)}>
            {submitting ? <Loader2 className="animate-spin" /> : <FlaskConical />}
            Start backtest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
