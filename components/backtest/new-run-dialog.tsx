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
import { CombinedFields, parseCombined, toCombinedValues, type CombinedValues } from "./combined-fields";
import { cn } from "@/lib/utils";

const PRESET_DAYS = [3, 7, 12, 30];
const DEFAULT_MAX_SIGNATURES = 50_000;
// pump.fun's user-trades API only keeps about this many days of a wallet's history; beyond it the chain (RPC) is the way.
const API_HISTORY_DAYS = 60;
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

  const addresses = scope === "selected" ? selected : allAddresses;
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
    if (addresses.length === 0) {
      toast.error("No addresses to backtest");
      return;
    }
    setSubmitting(true);
    try {
      const { run } = await createBacktestRun({
        name: name.trim() || undefined,
        days: daysNumber,
        profileId,
        addresses,
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
            <Label>Backtest style</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={mode === "separate" ? "default" : "outline"} onClick={() => setMode("separate")}>
                Separate wallets
              </Button>
              <Button type="button" size="sm" variant={mode === "combined" ? "default" : "outline"} onClick={() => setMode("combined")}>
                Combined wallet
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === "combined"
                ? "All the addresses trade together as ONE wallet: one starting balance and one trade amount shared by every trade, added up in the order the trades happened. Shows the group's daily P&L and how often the balance went negative."
                : "Each address is judged on its own wallet, so you can compare the addresses and drop the weak ones."}
            </p>
          </div>

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
            <Label>How to read the trades</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={collectMethod === "api" ? "default" : "outline"} onClick={() => setCollectMethod("api")}>
                API (fast)
              </Button>
              <Button type="button" size="sm" variant={collectMethod === "rpc" ? "default" : "outline"} onClick={() => setCollectMethod("rpc")}>
                RPC (slow, long history)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {collectMethod === "rpc"
                ? "Lists each address's transactions over RPC and reads the pump.fun trades out of them. Much slower and uses a lot of requests, but reaches as far back as the RPC keeps history - use it for long windows."
                : "Takes each address's trades from pump.fun's API: a few dozen requests per address, so it is much faster. pump.fun only keeps about the last 60 days, so use RPC for longer windows."}
            </p>
            {collectMethod === "api" && daysValid && daysNumber > API_HISTORY_DAYS && (
              <p className="text-xs text-amber-500">
                {daysNumber} days is more than pump.fun keeps - the oldest part of the window would be missing. Switch to RPC to cover it.
              </p>
            )}
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
            {previewStrategy ? <StrategyChips settings={previewStrategy} /> : <p className="text-xs text-muted-foreground">Loading the profile&apos;s settings…</p>}
            <p className="text-xs text-muted-foreground">Copied when you start - editing the profile later never changes this backtest.</p>
          </div>

          {isCombined && combined && (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div>
                <p className="text-sm font-medium">Combined wallet and fees</p>
                <p className="text-xs text-muted-foreground">Filled in from the profile. Change the balance, the trade amount or the fees to see what result you would get.</p>
              </div>
              <CombinedFields values={combined} onChange={setCombined} />
            </div>
          )}

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
              <p className="text-sm font-medium">{isCombined ? "Speed" : "Speed and loss traders"}</p>
              <p className="text-xs text-muted-foreground">
                {isCombined
                  ? "Choose how many addresses run at once and how many days of one address. There are no loss-trader rules in a combined backtest: dropping one address would change the wallet the others share."
                  : "Work through a large list faster: choose how many addresses (and how many days of one address) run at once, and drop a trader that is clearly losing instead of simulating every token it bought."}
              </p>
            </div>
            <ScreeningFields values={screening} onChange={setScreening} autoParallelism={autoParallelism} speedOnly={isCombined} />
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
          <Button onClick={handleSubmit} disabled={submitting || addresses.length === 0 || !daysValid || !maxSignaturesValid || !screeningNumbers || (timing !== null && !timingNumbers) || (isCombined && !combinedNumbers)}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Start backtest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
