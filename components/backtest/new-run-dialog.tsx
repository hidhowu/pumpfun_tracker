"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createBacktestRun } from "@/lib/backtest-api";
import { getSettings } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import type { BacktestStrategy } from "@/lib/backtest-types";
import { StrategyChips } from "./shared";
import { cn } from "@/lib/utils";

const PRESET_DAYS = [3, 7, 12, 30];
const DEFAULT_MAX_SIGNATURES = 50_000;
const MAX_DAYS = 120;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string[];
  allAddresses: string[];
  // Addresses on the list that have no pump.fun user ID (they are collected over RPC, which is much slower).
  noUserIdAddresses?: Set<string>;
  onCreated: (runId: string) => void;
};

/**
 * Creates a backtest: how many days back, which profile's settings to follow
 * (frozen into the run), and which addresses. The profile's strategy is
 * previewed here so there is no surprise about what will be simulated.
 */
export function NewRunDialog({ open, onOpenChange, selected, allAddresses, noUserIdAddresses, onCreated }: Props) {
  const { profiles, currentProfileId } = useProfile();
  const [name, setName] = useState("");
  const [days, setDays] = useState("7");
  const [maxSignatures, setMaxSignatures] = useState(String(DEFAULT_MAX_SIGNATURES));
  const [profileId, setProfileId] = useState<string>("");
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [submitting, setSubmitting] = useState(false);
  const [strategy, setStrategy] = useState<BacktestStrategy | null>(null);

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
    getSettings(profileId)
      .then(({ settings }) => {
        if (cancelled) return;
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
      .catch(() => !cancelled && setStrategy(null));
    return () => {
      cancelled = true;
    };
  }, [open, profileId]);

  const addresses = scope === "selected" ? selected : allAddresses;
  const slowCount = noUserIdAddresses ? addresses.filter((a) => noUserIdAddresses.has(a)).length : 0;
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= MAX_DAYS;
  // Empty or 0 = no limit.
  const maxSignaturesNumber = maxSignatures === "" ? 0 : Number(maxSignatures);
  const maxSignaturesValid = Number.isInteger(maxSignaturesNumber) && maxSignaturesNumber >= 0;

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
    if (addresses.length === 0) {
      toast.error("No addresses to backtest");
      return;
    }
    setSubmitting(true);
    try {
      const { run } = await createBacktestRun({ name: name.trim() || undefined, days: daysNumber, profileId, addresses, maxSignatures: maxSignaturesNumber });
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
              A very busy address takes very long to read, so one with more than this inside the window is stopped and marked Skipped. It counts signatures for an address read over RPC and trades for one with a user ID. 0 = no limit.
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
            {slowCount > 0 && (
              <p className="text-xs text-amber-500">
                {slowCount} of these {slowCount === 1 ? "has" : "have"} no pump.fun user ID, so {slowCount === 1 ? "it is" : "they are"} read from the chain over RPC - much slower. Add {slowCount === 1 ? "it" : "them"} again as JSON with the user ID to
                speed that up.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || addresses.length === 0 || !daysValid || !maxSignaturesValid}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Start backtest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
