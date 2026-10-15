"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { controlBacktestRun } from "@/lib/backtest-api";

type Props = {
  run: { _id: string; name: string; collectMethod?: "api" | "rpc" };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestarted: () => void;
};

/**
 * Mount it only while it is open (its choice of method starts from the backtest's current one each time).
 * Starts a backtest over from its first address: every result is thrown away and every address goes back to waiting. The window, the
 * settings and the addresses stay, and what was already collected is reused. The trades can be read the other way this time.
 */
export function RestartRunDialog({ run, open, onOpenChange, onRestarted }: Props) {
  const [method, setMethod] = useState<"api" | "rpc">(run.collectMethod === "rpc" ? "rpc" : "api");
  const [busy, setBusy] = useState(false);

  async function restart() {
    setBusy(true);
    try {
      await controlBacktestRun(run._id, "restart", { collectMethod: method });
      toast.success(`"${run.name}" restarted from the first address`);
      onOpenChange(false);
      onRestarted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to restart");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restart &quot;{run.name}&quot; from the first address?</AlertDialogTitle>
          <AlertDialogDescription>
            Every result of this backtest is thrown away and all its addresses go back to waiting. Its window, settings and addresses stay the same, and the
            trades already collected are kept, so it is much faster than the first time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Read the trades from</span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={method === "api" ? "default" : "outline"} onClick={() => setMethod("api")}>
              API (fast)
            </Button>
            <Button type="button" size="sm" variant={method === "rpc" ? "default" : "outline"} onClick={() => setMethod("rpc")}>
              RPC (slow, long history)
            </Button>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button className="bg-negative text-negative-foreground hover:bg-negative/90" disabled={busy} onClick={restart}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Restart
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
