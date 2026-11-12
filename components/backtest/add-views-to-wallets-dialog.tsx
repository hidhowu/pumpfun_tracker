"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsList, SettingsRow } from "@/components/ui/settings-row";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { listWallets } from "@/lib/api";
import { createWalletsFromViews, type WalletsFromViewsResult } from "@/lib/backtest-api";
import { formatUsd } from "@/lib/format";
import type { BacktestViewDefinition } from "@/lib/backtest-types";
import type { WalletView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CheckMark, DialogHead, Field } from "./dialog-parts";

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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHead
          icon={<Wallet className="size-5" />}
          title={result ? "Wallets created" : "Add combined views to wallets"}
          help="Each ticked view becomes a wallet that tracks its addresses live. It starts fresh from the view's starting balance - none of the backtest's trades are copied. Addresses that aren't tracked yet are added to tracking."
          description="Create a wallet from each selected combined view."
        />

        {result ? (
          <div className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto">
            {result.created.map((c) => (
              <div key={c.walletId} className="flex flex-col gap-0.5 rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
                <Link href={`/wallets/${c.walletId}`} className="text-[13.5px] font-semibold hover:text-primary">
                  {c.name}
                </Link>
                <p className="text-xs text-text-3">
                  {c.added} of {c.addresses} addresses tracking
                  {c.blacklisted > 0 ? ` · ${c.blacklisted} blacklisted (skipped)` : ""}
                  {c.invalid > 0 ? ` · ${c.invalid} invalid (skipped)` : ""}
                </p>
              </div>
            ))}
            {result.skipped.map((s) => (
              <p key={s.viewId} className="px-1 text-xs text-text-3">
                Skipped &quot;{s.name}&quot;: {s.reason}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {picked.size} of {views.length} selected
              </span>
              <Button variant="outline" size="sm" onClick={() => setPicked(picked.size === views.length ? new Set() : new Set(views.map((v) => v._id)))}>
                {picked.size === views.length ? "Clear" : "Select all"}
              </Button>
            </div>
            <div className="flex max-h-[40dvh] flex-col gap-1.5 overflow-y-auto">
              {views.map((v) => {
                const on = picked.has(v._id);
                return (
                  <button
                    key={v._id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(v._id)}
                    className={cn(
                      "flex items-start gap-3 rounded-[14px] border bg-surface-2 px-3.5 py-3 text-left transition-colors",
                      on ? "border-volt-line bg-volt-soft" : "border-border hover:border-line-2"
                    )}
                  >
                    <CheckMark checked={on} className="mt-0.5" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <b className="truncate text-[13.5px] font-semibold">{v.name}</b>
                      <span className="text-xs text-text-3">
                        {v.allAddresses ? "all addresses" : `${v.addressCount} addresses`} · {formatUsd(v.startingBalanceUsd)} start · {formatUsd(v.tradeSizeUsd)}/trade · {v.pumpFeePercent}% + {formatUsd(v.jitoFeeUsd)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <Field
              label="Import settings from an existing wallet"
              optional
              htmlFor="views-wallet"
              help="Stop-loss, take-profit, trailing stops, max trade time, execution delay and dust settings come from that wallet. The view's own balance, trade amount and fees are kept."
            >
              <Select value={walletId} onValueChange={setWalletId}>
                <SelectTrigger id="views-wallet" className="w-full max-md:h-11">
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
            </Field>
            {walletId !== NO_WALLET && (
              <SettingsList>
                <SettingsRow label="Also take balance, trade amount, fees and daily reset from that wallet" htmlFor="money-too">
                  <Switch id="money-too" checked={moneyToo} onCheckedChange={setMoneyToo} />
                </SettingsRow>
              </SettingsList>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant={result ? "outline" : "ghost"}>{result ? "Close" : "Cancel"}</Button>
          </DialogClose>
          {!result && (
            <Button className="gap-1.5" disabled={busy || picked.size === 0} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" /> : <Wallet />}
              Create {picked.size} wallet{picked.size === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
