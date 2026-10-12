"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createBacktestRun, getBacktestSettings } from "@/lib/backtest-api";
import { getSettings } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import type { BacktestStrategy } from "@/lib/backtest-types";
import { StrategyChips } from "./shared";
import { ScreeningFields, parseScreening, type ScreeningValues } from "./screening-fields";
import { TimingFields, parseTiming, toTimingValues, type TimingValues } from "./timing-fields";
import { cn } from "@/lib/utils";

const PRESET_DAYS = [3, 7, 12, 30];
const DEFAULT_MAX_SIGNATURES = 50_000;
const MAX_DAYS = 120;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  allAddresses: string[];
  onCreated: (runId: string) => void;
};

/**
 * Creates a backtest: how many days back, which profile's settings to follow
 * (frozen into the run), and which addresses. The profile's strategy is
 * previewed here so there is no surprise about what will be simulated.
 */
export function NewRunDialog({ open, onOpenChange, selected, allAddresses, onCreated }: Props) {
  const { profiles, currentProfileId } = useProfile();
  const [name, setName] = useState("");
  const [days, setDays] = useState("7");
  const [maxSignatures, setMaxSignatures] = useState(String(DEFAULT_MAX_SIGNATURES));
  const [profileId, setProfileId] = useState<string>("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [submitting, setSubmitting] = useState(false);
  const [strategy, setStrategy] = useState<BacktestStrategy | null>(null);
  const [timing, setTiming] = useState<TimingValues | null>(null);
  const [screening, setScreening] = useState<ScreeningValues>({ addressParallelism: "", lossDays: "0", dayLossPercent: "0", negativeBalanceEvents: "0", lossAtProgressPercent: "0" });
  const [autoParallelism, setAutoParallelism] = useState<number | undefined>();

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
      });
    return () => {
      cancelled = true;
    };
  }, [open, profileId]);

  const addresses = scope === "selected" ? selected : allAddresses;
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= MAX_DAYS;
  // Empty or 0 = no limit.
  const maxSignaturesNumber = maxSignatures === "" ? 0 : Number(maxSignatures);
  const maxSignaturesValid = Number.isInteger(maxSignaturesNumber) && maxSignaturesNumber >= 0;

  const timingNumbers = timing ? parseTiming(timing) : null;
  const screeningNumbers = parseScreening(screening);

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
    if (addresses.length === 0) {
      toast.error("No addresses to backtest");
      return;
    }
    setSubmitting(true);
    try {
      const { run } = await createBacktestRun({ name: name.trim() || undefined, days: daysNumber, profileId, addresses, maxSignatures: maxSignaturesNumber, ...(timingNumbers ? { overrides: timingNumbers } : {}), earlyStop: screeningNumbers.earlyStop, addressParallelism: screeningNumbers.addressParallelism });
      toast.success(`Backtest started on ${addresses.length} address${addresses.length === 1 ? "" : "es"}`);
      onOpenChange(false);
      onCreated(run._id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start the backtest");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New backtest</DialogTitle>
          <DialogDescription>
            Replays each address&apos;s trades from the last N days against the real pool history, using the chosen profile&apos;s settings.
            Anything already collected for an address in an earlier backtest is reused.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bt-name">Name (optional)</Label>
            <Input id="bt-name" placeholder={`${daysValid ? daysNumber : "7"}-day backtest`} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bt-days">Days back from now</Label>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_DAYS.map((d) => (
                <Button key={d} type="button" size="sm" variant={Number(days) === d ? "default" : "outline"} onClick={() => setDays(String(d))}>
                  {d}d
                </Button>
              ))}
              <Input
                id="bt-days"
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, ""))}
                className={cn("w-20", !daysValid && days !== "" && "border-negative")}
                aria-invalid={!daysValid}
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bt-max-signatures">Skip addresses with more signatures than</Label>
            <Input
              id="bt-max-signatures"
              inputMode="numeric"
              value={maxSignatures}
              onChange={(e) => setMaxSignatures(e.target.value.replace(/[^0-9]/g, ""))}
              className={cn("w-32", !maxSignaturesValid && "border-negative")}
              aria-invalid={!maxSignaturesValid}
            />
            <p className="text-xs text-muted-foreground">
              A very busy address takes very long to read, so one with more than this inside the window is stopped and marked Skipped. It counts trades (signatures, if an address ever has to be read from the chain over RPC). 0 = no limit.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bt-profile">Follow the settings of</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="bt-profile" className="w-full">
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
            {strategy ? <StrategyChips settings={strategy} /> : <p className="text-xs text-muted-foreground">Loading the profile&apos;s settings…</p>}
            <p className="text-xs text-muted-foreground">Copied when you start - editing the profile later never changes this backtest.</p>
          </div>

          {timing && (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div>
                <p className="text-sm font-medium">Timing</p>
                <p className="text-xs text-muted-foreground">
                  Filled in from the profile and live settings so the backtest behaves like a live run. Change them to test a different setup.
                </p>
              </div>
              <TimingFields values={timing} onChange={setTiming} />
            </div>
          )}

          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <div>
              <p className="text-sm font-medium">Speed and loss traders</p>
              <p className="text-xs text-muted-foreground">
                Work through a large list faster: choose how many addresses run at once, and drop a trader that is clearly losing instead of simulating every token it bought.
              </p>
            </div>
            <ScreeningFields values={screening} onChange={setScreening} autoParallelism={autoParallelism} />
          </div>

          <div className="space-y-1.5">
            <Label>Addresses</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={scope === "selected" ? "default" : "outline"}
                disabled={selected.length === 0}
                onClick={() => setScope("selected")}
              >
                Selected ({selected.length})
              </Button>
              <Button type="button" size="sm" variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>
                All on the list ({allAddresses.length})
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || addresses.length === 0 || !daysValid || !maxSignaturesValid || !screeningNumbers || (timing !== null && !timingNumbers)}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Start backtest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
