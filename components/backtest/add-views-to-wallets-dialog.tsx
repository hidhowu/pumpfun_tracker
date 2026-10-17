"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listWallets } from "@/lib/api";
import { createWalletsFromViews, type WalletsFromViewsResult } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestViewDefinition } from "@/lib/backtest-types";
import type { WalletView } from "@/lib/types";

const NO_WALLET = "none";

type Props = {
  runId: string;
  views: BacktestViewDefinition[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Adds combined views to the Wallets page: one wallet per view, with its addresses as the wallet's traders and its balance, trade amount and fees.
 * The wallet starts clean from its starting balance - none of the backtest's trades are copied. Optionally the exit settings (stop-loss, take-profit,
 * trailing stops...) are imported from an existing wallet.
 */
export function AddViewsToWalletsDialog({ runId, views, open, onOpenChange }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(views.map((v) => v._id)));
  const [wallets, setWallets] = useState<WalletView[]>([]);
  const [walletId, setWalletId] = useState(NO_WALLET);
  const [moneyToo, setMoneyToo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WalletsFromViewsResult | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listWallets()
      .then(({ wallets }) => !cancelled && setWallets(wallets))
      .catch(() => !cancelled && setWallets([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    try {
      const res = await createWalletsFromViews({
        runId,
        viewIds: [...picked],
        settingsFromWalletId: walletId === NO_WALLET ? undefined : walletId,
        useWalletMoneySettings: walletId !== NO_WALLET && moneyToo,
      });
      setResult(res);
      toast.success(`Created ${res.created.length} wallet${res.created.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create the wallets");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Add combined views to wallets</DialogTitle>
          <DialogDescription>
            Each ticked view becomes a wallet that tracks its addresses live. It starts fresh from the view&apos;s starting balance - none of the backtest&apos;s trades are copied.
            Addresses that aren&apos;t tracked yet are added to tracking.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto text-sm">
            {result.created.map((c) => (
              <div key={c.walletId} className="rounded-md border border-border/60 px-3 py-2">
                <Link href={`/wallets/${c.walletId}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {c.added} of {c.addresses} addresses tracking
                  {c.blacklisted > 0 ? ` · ${c.blacklisted} blacklisted (skipped)` : ""}
                  {c.invalid > 0 ? ` · ${c.invalid} invalid (skipped)` : ""}
                </p>
              </div>
            ))}
            {result.skipped.map((s) => (
              <p key={s.viewId} className="text-xs text-muted-foreground">
                Skipped &quot;{s.name}&quot;: {s.reason}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {picked.size} of {views.length} selected
              </span>
              <button type="button" className="underline" onClick={() => setPicked(picked.size === views.length ? new Set() : new Set(views.map((v) => v._id)))}>
                {picked.size === views.length ? "Clear" : "Select all"}
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto rounded-md border border-border/60">
              {views.map((v) => (
                <label key={v._id} className="flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2 last:border-b-0">
                  <input type="checkbox" checked={picked.has(v._id)} onChange={() => toggle(v._id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {v.allAddresses ? "all addresses" : `${v.addressCount} addresses`} · {formatUsd(v.startingBalanceUsd)} start · {formatUsd(v.tradeSizeUsd)}/trade · {v.pumpFeePercent}% +{" "}
                      {formatUsd(v.jitoFeeUsd)}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Import settings from an existing wallet (optional)</Label>
              <Select value={walletId} onValueChange={setWalletId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_WALLET}>None - use only the view&apos;s own settings</SelectItem>
                  {wallets.map((w) => (
                    <SelectItem key={w._id} value={w._id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {walletId !== NO_WALLET && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Stop-loss, take-profit, trailing stops, max trade time, execution delay and dust settings come from that wallet. The view&apos;s own balance, trade amount and fees are kept.
                  </p>
                  <div className="flex items-center gap-2">
                    <Switch id="money-too" checked={moneyToo} onCheckedChange={setMoneyToo} />
                    <Label htmlFor="money-too" className="text-sm font-normal">
                      Also take starting balance, trade amount, fees and daily reset from that wallet
                    </Label>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{result ? "Close" : "Cancel"}</Button>
          </DialogClose>
          {!result && (
            <Button className="gap-1.5" disabled={busy || picked.size === 0} onClick={submit}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
              Create {picked.size} wallet{picked.size === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
