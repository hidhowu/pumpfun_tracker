"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Link2, Loader2, Rocket, ShieldAlert, TestTube2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateTrading } from "@/lib/live-wallet-api";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExitMode, TradingState } from "@/lib/live-wallet-types";

const PLAIN_FOOTER = "mx-0 mb-0 border-0 bg-transparent p-0 pt-2";

/** Real money: asks for a fresh authenticator code before the wallet starts sending real transactions. */
function GoLiveDialog({ open, onOpenChange, walletId, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; walletId: string; onDone: (state: TradingState) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function confirm() {
    if (!/^\d{6}$/.test(code) || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const state = await updateTrading(walletId, { tradingMode: "live", code });
      setCode("");
      onOpenChange(false);
      onDone(state);
      toast.success("Live trading is on - real transactions will be sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't switch to live");
      setCode("");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <span className="mb-1 flex size-14 items-center justify-center rounded-full bg-negative/15 text-negative">
            <Rocket className="size-7" />
          </span>
          <DialogTitle className="text-2xl font-extrabold tracking-tight">Start trading for real?</DialogTitle>
          <DialogDescription className="leading-relaxed">
            From now on every trade the connected simulation wallet takes is also sent to the chain from this wallet, with its own money. Positions stay open until they are sold. You can switch back to a dry run at any time; positions already open are still managed and sold for real when they exit.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="go-live-code" className="text-[13px] font-bold text-muted-foreground">
            Authenticator code
          </Label>
          <Input
            id="go-live-code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            className="h-14 border-primary/70 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">A code works only once. If you just used it, wait for the next one.</p>
        </div>
        <DialogFooter className={PLAIN_FOOTER}>
          <Button variant="outline" className="h-11 px-5" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button className="h-11 bg-negative px-6 text-negative-foreground hover:bg-negative/90" onClick={confirm} disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            Go live
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Segmented<T extends string>({ value, options, onChange, disabled }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div className="inline-flex w-full rounded-xl border border-border bg-secondary p-1 sm:w-fit" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "flex-1 rounded-lg px-3.5 py-1.5 text-[13px] font-bold whitespace-nowrap transition-colors disabled:opacity-50 sm:flex-none",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Connecting a live wallet to a simulation wallet and the switches that go with it: dry run / live, which exit rules the live wallet follows,
 * and how much price movement a trade tolerates. A new connection always starts as a dry run (nothing is sent).
 */
export function TradingConnection({
  walletId,
  state,
  twoFactorEnabled,
  onChange,
}: {
  walletId: string;
  state: TradingState;
  twoFactorEnabled: boolean;
  onChange: (state: TradingState) => void;
}) {
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [goLive, setGoLive] = useState(false);
  const [buySlip, setBuySlip] = useState(String(state.buySlippagePercent));
  const [sellSlip, setSellSlip] = useState(String(state.sellSlippagePercent));
  const sim = state.simWallet;

  async function apply(patch: Parameters<typeof updateTrading>[1], success?: string) {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await updateTrading(walletId, patch));
      if (success) toast.success(success);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the settings");
    } finally {
      setBusy(false);
    }
  }

  if (!twoFactorEnabled) {
    return (
      <Card className="gap-3 p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-negative" />
          <div>
            <div className="text-[15px] font-extrabold">Turn on two-factor first</div>
            <p className="mt-1 text-sm text-muted-foreground">Connecting a wallet to trade needs an account with two-factor sign-in turned on.</p>
            <Button asChild className="mt-3">
              <Link href="/account">Turn on two-factor</Link>
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (!state.connected || !sim) {
    const free = state.availableWallets.filter((w) => !w.taken);
    return (
      <Card className="gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-brand-soft">
            <Link2 className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold">Connect to a simulation wallet</div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              This wallet then takes the same trades as that simulation wallet, with the same trade size, fees and exit rules - but at once, without the simulated execution delay. It starts as a <b className="text-foreground">dry run</b>: every trade is priced against the real chain and recorded, but nothing is sent.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="h-10 w-full sm:w-72" aria-label="Simulation wallet">
              <SelectValue placeholder={free.length ? "Choose a simulation wallet" : "No free simulation wallet"} />
            </SelectTrigger>
            <SelectContent>
              {state.availableWallets.map((w) => (
                <SelectItem key={w._id} value={w._id} disabled={w.taken}>
                  {w.name}
                  {w.taken ? " (already connected)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="h-10 gap-2" disabled={!choice || busy} onClick={() => apply({ connectedWalletId: choice }, "Connected - running as a dry run")}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Connect
          </Button>
        </div>
      </Card>
    );
  }

  const live = state.tradingMode === "live";
  const slipChanged = Number(buySlip) !== state.buySlippagePercent || Number(sellSlip) !== state.sellSlippagePercent;
  const rules = [
    `trade size ${formatUsd(sim.settings.tradeSizeUsd)}`,
    `Jito fee ${formatUsd(sim.settings.jitoFeeUsd)}`,
    sim.settings.stopLossPercent != null ? `stop-loss ${sim.settings.stopLossPercent}%` : null,
    sim.settings.takeProfitPercent != null ? `take-profit ${sim.settings.takeProfitPercent}%` : null,
    sim.settings.maxTradeTimeSeconds > 0 ? `max hold ${Math.round(sim.settings.maxTradeTimeSeconds / 60)} min` : null,
    sim.settings.trailingStops.length ? `${sim.settings.trailingStops.length} trailing stop${sim.settings.trailingStops.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <Card className="gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-extrabold">Copying</span>
            <Link href={`/wallets/${sim._id}`} className="truncate text-[15px] font-extrabold text-brand-soft hover:underline">
              {sim.name}
            </Link>
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold", live ? "bg-negative/15 text-negative" : "bg-primary/15 text-brand-soft")}>
              {live ? <Rocket className="size-3" /> : <TestTube2 className="size-3" />}
              {live ? "LIVE" : "Dry run"}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">Inherits {rules.join(" · ")}. No execution delay.</p>
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-negative" disabled={busy} onClick={() => apply({ connectedWalletId: null }, "Disconnected")}>
          <Unplug className="size-4" /> Disconnect
        </Button>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-[13px] font-bold text-muted-foreground">Mode</Label>
          <Segmented
            value={state.tradingMode}
            disabled={busy}
            options={[
              { value: "dry", label: "Dry run" },
              { value: "live", label: "Live" },
            ]}
            onChange={(mode) => {
              if (mode === state.tradingMode) return;
              if (mode === "live") setGoLive(true);
              else void apply({ tradingMode: "dry" }, "Back to a dry run - new trades are not sent. Positions already open are still sold for real when they exit.");
            }}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {live ? "Real transactions are sent through Jito from this wallet." : "Trades are priced against the real chain and recorded, nothing is sent and nothing is spent."}
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-[13px] font-bold text-muted-foreground">Stop-loss, take-profit and trailing stops use</Label>
          <Segmented<ExitMode>
            value={state.exitMode}
            disabled={busy}
            options={[
              { value: "own", label: "Its own entry" },
              { value: "follow", label: "Follow simulation" },
            ]}
            onChange={(exitMode) => exitMode !== state.exitMode && void apply({ exitMode })}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {state.exitMode === "own"
              ? "The live position is judged by what it really paid. The trader's sells and blacklisting still sell it at once."
              : "The live wallet sells whenever the simulated position exits. In a dry run both ways are worked out side by side, so you can compare them."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="buy-slip" className="text-[13px] font-bold text-muted-foreground">
            Buy slippage (%)
          </Label>
          <Input id="buy-slip" inputMode="decimal" value={buySlip} onChange={(e) => setBuySlip(e.target.value.replace(/[^0-9.]/g, ""))} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sell-slip" className="text-[13px] font-bold text-muted-foreground">
            Sell slippage (%)
          </Label>
          <Input id="sell-slip" inputMode="decimal" value={sellSlip} onChange={(e) => setSellSlip(e.target.value.replace(/[^0-9.]/g, ""))} className="h-10" />
        </div>
        <Button variant="outline" className="h-10" disabled={busy || !slipChanged} onClick={() => apply({ buySlippagePercent: Number(buySlip), sellSlippagePercent: Number(sellSlip) }, "Slippage saved")}>
          Save
        </Button>
      </div>
      <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
        The price may move this far against a trade before the program refuses it. A refused trade costs nothing: with Jito it never lands, so no fee and no tip are paid.
      </p>

      {state.warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[13px] leading-relaxed text-amber-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {w}
        </div>
      ))}

      <GoLiveDialog open={goLive} onOpenChange={setGoLive} walletId={walletId} onDone={onChange} />
    </Card>
  );
}
