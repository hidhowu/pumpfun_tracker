"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { blacklistBacktestAddresses } from "@/lib/backtest-api";

/**
 * Confirm-and-do for blacklisting addresses from the backtest side. The
 * blacklist is the platform's shared one, so a blacklisted address is also
 * blocked from live trading - and one that is already a live trader is
 * blacklisted there too (its open simulated positions are sold).
 */
export function BlacklistDialog({
  open,
  onOpenChange,
  addresses,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addresses: string[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const n = addresses.length;

  async function run() {
    setBusy(true);
    try {
      const res = await blacklistBacktestAddresses(addresses);
      const parts: string[] = [];
      const fresh = res.blacklisted.length;
      if (fresh) parts.push(`${fresh} blacklisted`);
      if (res.liveBlacklisted.length) {
        parts.push(`${res.liveBlacklisted.length} also blacklisted on live trading${res.closingPositions > 0 ? ` (selling ${res.closingPositions} open position${res.closingPositions === 1 ? "" : "s"})` : ""}`);
      }
      if (res.alreadyBlacklisted.length) parts.push(`${res.alreadyBlacklisted.length} already blacklisted`);
      toast.success(parts.join(", ") || "Done");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to blacklist");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Blacklist {n} address{n === 1 ? "" : "es"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {n === 1 ? "It leaves" : "They leave"} the backtest list and {n === 1 ? "is" : "are"} added to the Blacklisted page, so {n === 1 ? "it" : "they"} can&apos;t be added to live trading - or back onto the backtest list -
            by accident later. If {n === 1 ? "it is" : "any of them are"} already a live trader, {n === 1 ? "it is" : "they are"} blacklisted there too: tracking stops and open simulated positions are sold. Past backtests keep their results.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-negative text-negative-foreground hover:bg-negative/90"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              run();
            }}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Blacklist
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
