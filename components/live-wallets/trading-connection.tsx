"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CircleCheck, CircleDashed, FlaskConical, Link2, Loader2, Pause, Play, Rocket, ShieldOff, Unplug, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { SettingsList, SettingsRow } from "@/components/ui/settings-row";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { DialogHead, Field, Group, Inset, Notice } from "@/components/ui/dialog-parts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createLookupTable, updateTrading } from "@/lib/live-wallet-api";
import { formatSol, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { styleLabel } from "@/lib/live-wallet-styles";
import { signedUsd } from "./shared";
import type { ExitMode, SendMode, TradingState, TradingSummary } from "@/lib/live-wallet-types";

/** The wallet's own SOL balance, for the "is it funded" line of the go-live check. */
type Funding = { solBalance: number; solUsd: number | null } | null;

const MODES = [
  { value: "dry", label: "Dry run" },
  { value: "live", label: "Live" },
] as const;
const SEND_MODES = [
  { value: "raw", label: "Raw (low fee)" },
  { value: "jito", label: "Jito (tipped)" },
] as const;
const SCALE = [
  { value: "on", label: "Scale (never above the simulation's)" },
  { value: "off", label: "Full fee" },
] as const;

const EXIT_HELP: Record<string, string> = {
  own: "Judged by what the live position really paid. The trader's sells and blacklisting still sell it at once.",
  follow: "Sells whenever the simulated position exits. In a dry run every way is worked out side by side, so you can compare them.",
  apiplus: "Same rules as its own entry, read from the token's trade list at each risk check (every 2 s). In a dry run it is worked out side by side with the other ways.",
};
const cooldownHelp = (id: string, stop: number | undefined) =>
  `First ${styleLabel(id).replace("Cool-down ", "")}: only a deep stop-loss${stop != null ? ` (${stop}%)` : ""}, a take-profit, the max hold time or a positive trailing stop can sell; negative trailing stops wait until it is over. A dry run works every way out side by side.`;

/** One line of the go-live check: a tick or a warning, what it is, and (optionally) a fix button. */
function CheckRow({ ok, title, detail, action }: { ok: boolean; title: string; detail?: React.ReactNode; action?: React.ReactNode }) {
  const Icon = ok ? CircleCheck : CircleDashed;
  return (
    <div className="flex items-start gap-3 rounded-[14px] border border-border bg-surface-2 px-3.5 py-3">
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", ok ? "text-positive" : "text-warn")} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="text-[13.5px] font-semibold">{title}</b>
        {detail ? <span className="text-xs leading-[18px] text-text-2">{detail}</span> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Real money, in two steps: first a read-only check of what is ready (nothing here blocks), then a fresh authenticator code before the wallet starts
 * sending real transactions.
 */
function GoLiveDialog({
  open,
  onOpenChange,
  walletId,
  state,
  summary,
  funding,
  onDone,
  onLookupChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletId: string;
  state: TradingState;
  summary: TradingSummary | null;
  funding: Funding;
  onDone: (state: TradingState) => void;
  onLookupChanged: () => void;
}) {
  const [step, setStep] = useState<"check" | "confirm">("check");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const inFlight = useRef(false);

  function handleOpenChange(next: boolean) {
    if (busy) return;
    onOpenChange(next);
    if (!next) {
      setStep("check");
      setCode("");
    }
  }

  async function confirm() {
    if (!/^\d{6}$/.test(code) || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const next = await updateTrading(walletId, { tradingMode: "live", code });
      setCode("");
      setStep("check");
      onOpenChange(false);
      onDone(next);
      toast.success("Live trading is on - real transactions will be sent");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't switch to live");
      setCode("");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function fixLookup() {
    setFixing(true);
    try {
      const r = await createLookupTable(walletId);
      toast.success(r.added > 0 ? `Lookup table ready: ${r.total} accounts (${r.added} added)` : "The lookup table already has everything it needs");
      onLookupChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the lookup table");
    } finally {
      setFixing(false);
    }
  }

  const tradeUsd = state.effective?.tradeSizeUsd ?? null;
  const solUsd = funding?.solUsd ?? state.solUsd;
  const affordable = funding && solUsd && tradeUsd ? Math.floor((funding.solBalance * solUsd) / tradeUsd) : null;
  const s = summary?.settled;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        {step === "check" ? (
          <>
            <DialogHead
              icon={<Rocket className="size-5" />}
              title="Ready to go live?"
              help="A quick look at what is set up. Nothing here blocks you; it is only so you know."
              description="Check the wallet before it starts trading for real."
            />
            <div className="flex flex-col gap-2">
              <CheckRow ok title="Two-factor is on" detail="You will confirm with a fresh authenticator code." />
              <CheckRow ok title={`Connected to "${state.simWallet?.name ?? ""}"`} />
              <CheckRow
                ok={affordable == null ? !!funding && funding.solBalance > 0 : affordable >= 1}
                title="Wallet funded"
                detail={funding ? `${formatSol(funding.solBalance)}${affordable != null ? ` — enough for ${affordable} trade${affordable === 1 ? "" : "s"} at ${formatUsd(tradeUsd)}` : ""}` : "The balance can't be read right now."}
              />
              <CheckRow
                ok={!!state.lookupTable}
                title={state.lookupTable ? "Lookup table created" : "Lookup table not created yet"}
                detail={state.lookupTable ? undefined : "Bigger swaps wait for it on the first trade. Create it now to avoid the wait (about 0.01-0.02 SOL rent, refundable)."}
                action={
                  state.lookupTable ? null : (
                    <Button size="sm" variant="outline" disabled={fixing} onClick={fixLookup}>
                      {fixing ? <Loader2 className="animate-spin" /> : null} Fix
                    </Button>
                  )
                }
              />
              <CheckRow
                ok={!!s && s.trades > 0}
                title={s && s.trades > 0 ? "Dry run looks healthy" : "No finished dry-run trades yet"}
                detail={s && s.trades > 0 ? `${s.trades} trade${s.trades === 1 ? "" : "s"} · live ${signedUsd(s.livePnlUsd)} vs simulation ${signedUsd(s.simPnlUsd)}` : "Run as a dry run for a while first to see how the trades turn out."}
              />
            </div>
            <Inset title="What changes">
              <p className="text-[13px] leading-5 text-text-2">Every simulation trade is also sent from this wallet with its own money. You can return to a dry run any time.</p>
            </Inset>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={() => setStep("confirm")}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHead
              icon={<Rocket className="size-5" />}
              title="Start trading for real?"
              help="Positions stay open until they are sold. Positions already open are still managed and sold for real if you go back to a dry run."
              description="Confirm with an authenticator code."
            />
            <p className="-mt-1 text-[13px] leading-5 text-text-2">From now on every simulation trade is also sent on-chain from this wallet, with its own money.</p>
            <Field label="Authenticator code" htmlFor="go-live-code" help="A code works once. If you just used it, wait for the next one.">
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
                className="h-14 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
              />
            </Field>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep("check")} disabled={busy}>
                Back
              </Button>
              <Button className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={confirm} disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="animate-spin" /> : <Rocket />}
                Go live
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One choice of the exit way: a framed card with its explanation behind a "?". */
function ExitWayCard({ label, help, on, disabled, tag, onSelect }: { label: string; help: string; on: boolean; disabled?: boolean; tag?: string; onSelect: () => void }) {
  return (
    <div
      role="radio"
      aria-checked={on}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-[14px] border bg-surface-2 px-3.5 py-3 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
        on ? "border-volt-line bg-volt-soft" : "border-border hover:border-line-2"
      )}
    >
      <span className={cn("flex size-[18px] shrink-0 items-center justify-center rounded-full border", on ? "border-primary" : "border-line-3")}>{on && <span className="size-2 rounded-full bg-primary" />}</span>
      <b className="text-[13.5px] font-semibold">{label}</b>
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <HelpTip className="ml-0">{help}</HelpTip>
      </span>
      {tag ? <span className="ml-auto inline-flex h-5 items-center rounded-full border border-line-2 bg-surface-3 px-2 text-[11px] text-text-2">{tag}</span> : null}
    </div>
  );
}

/** An input with its own Save button, as one row of a settings list. */
function SaveRow({ label, help, htmlFor, children, onSave, canSave, busy }: { label: React.ReactNode; help?: React.ReactNode; htmlFor?: string; children: React.ReactNode; onSave: () => void; canSave: boolean; busy: boolean }) {
  return (
    <SettingsRow label={label} help={help} htmlFor={htmlFor}>
      <div className="flex items-center gap-2">
        {children}
        <Button variant="outline" size="sm" disabled={busy || !canSave} onClick={onSave}>
          Save
        </Button>
      </div>
    </SettingsRow>
  );
}

/**
 * Connecting a live wallet to a simulation wallet and the switches that go with it: dry run / live, which exit rules the live wallet follows,
 * and how much price movement a trade tolerates. A new connection always starts as a dry run (nothing is sent).
 */
export function TradingConnection({
  walletId,
  state,
  summary,
  funding,
  twoFactorEnabled,
  onChange,
  onRefresh,
}: {
  walletId: string;
  state: TradingState;
  summary: TradingSummary | null;
  funding: Funding;
  twoFactorEnabled: boolean;
  onChange: (state: TradingState) => void;
  onRefresh: () => void;
}) {
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [goLive, setGoLive] = useState(false);
  const [buySlip, setBuySlip] = useState(String(state.buySlippagePercent));
  const [sellSlip, setSellSlip] = useState(String(state.sellSlippagePercent));
  const [delay, setDelay] = useState(String(state.tradeDelaySeconds));
  const [tip, setTip] = useState(state.jitoTipUsd == null ? "" : String(state.jitoTipUsd));
  const [priority, setPriority] = useState(String(state.rawPriorityMicroLamports));
  const [ratioSim, setRatioSim] = useState(String(state.tradeRatioSim));
  const [ratioLive, setRatioLive] = useState(String(state.tradeRatioLive));
  // Cool-down styles being edited: minutes and the stop-loss that applies inside the cool-down, as typed.
  const [cooldowns, setCooldowns] = useState(state.cooldownStyles.map((c) => ({ minutes: String(c.seconds / 60), stop: String(c.stopLossPercent) })));
  const sim = state.simWallet;

  function saveCooldowns() {
    const next = cooldowns.map((c) => ({ seconds: Math.round(Number(c.minutes) * 60), stopLossPercent: Number(c.stop) }));
    if (next.some((c) => !Number.isFinite(c.seconds) || c.seconds <= 0 || !Number.isFinite(c.stopLossPercent) || c.stopLossPercent <= 0)) {
      toast.error("Give every cool-down a length in minutes and a stop-loss above 0.");
      return;
    }
    void apply({ cooldownStyles: next }, "Cool-down styles saved - new dry-run trades work them out too");
  }

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
      <section className="flex items-start gap-3.5 rounded-[20px] border border-border bg-card p-4 md:p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neg-soft text-destructive">
          <ShieldOff className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <b className="text-[15px] font-semibold">Turn on two-factor first</b>
          <p className="text-[13px] leading-5 text-text-2">Connecting a wallet to trade needs an account with two-factor sign-in turned on.</p>
          <Button asChild size="sm" className="mt-2 max-md:h-10">
            <Link href="/account">Turn on two-factor</Link>
          </Button>
        </div>
      </section>
    );
  }

  if (!state.connected || !sim) {
    const free = state.availableWallets.filter((w) => !w.taken);
    return (
      <section className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 md:p-5">
        <div className="flex items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-3 text-primary">
            <Link2 className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <b className="text-[15px] font-semibold">Connect to a simulation wallet</b>
            <p className="text-[13px] leading-5 text-text-2">
              This wallet then takes the same trades as that simulation wallet, with the same trade size, fees and exit rules — but at once, without the simulated execution delay. It starts as a{" "}
              <b className="font-semibold text-foreground">dry run</b>: every trade is priced against the real chain and recorded, but nothing is sent.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="w-full max-md:h-11 sm:w-72" aria-label="Simulation wallet">
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
          <Button className="gap-1.5 max-md:h-11" disabled={!choice || busy} onClick={() => apply({ connectedWalletId: choice }, "Connected - running as a dry run")}>
            {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
            Connect
          </Button>
        </div>
      </section>
    );
  }

  const live = state.tradingMode === "live";
  const slipChanged = Number(buySlip) !== state.buySlippagePercent;
  const sellSlipChanged = Number(sellSlip) !== state.sellSlippagePercent;
  const rules = [
    `trade size ${formatUsd(sim.settings.tradeSizeUsd)}`,
    `Jito fee ${formatUsd(sim.settings.jitoFeeUsd)}`,
    sim.settings.stopLossPercent != null ? `stop-loss ${sim.settings.stopLossPercent}%` : null,
    sim.settings.takeProfitPercent != null ? `take-profit ${sim.settings.takeProfitPercent}%` : null,
    sim.settings.maxTradeTimeSeconds > 0 ? `max hold ${Math.round(sim.settings.maxTradeTimeSeconds / 60)} min` : null,
    sim.settings.trailingStops.length ? `${sim.settings.trailingStops.length} trailing stop${sim.settings.trailingStops.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  const cooldownSummary = state.cooldownStyles.length ? state.cooldownStyles.map((c) => `${styleLabel(c.id).replace("Cool-down ", "")} (stop-loss ${c.stopLossPercent}%)`).join(" · ") : "none";
  const tipChanged = tip !== (state.jitoTipUsd == null ? "" : String(state.jitoTipUsd));
  const exitOptions: Array<{ value: ExitMode; label: string; help: string; tag?: string }> = [
    { value: "own", label: "Its own entry", help: EXIT_HELP.own },
    { value: "follow", label: "Follow simulation", help: EXIT_HELP.follow },
    { value: "apiplus", label: "API Plus", help: EXIT_HELP.apiplus },
    ...state.cooldownStyles.map((c) => ({ value: c.id, label: styleLabel(c.id), help: cooldownHelp(c.id, c.stopLossPercent) })),
  ];
  const execSummary = `Slippage ${state.buySlippagePercent} / ${state.sellSlippagePercent} % · wait ${state.tradeDelaySeconds} s · ${state.sendMode} · ${state.tradeRatioSim} : ${state.tradeRatioLive} size`;

  return (
    <section className="flex flex-col gap-4 rounded-[20px] border border-border bg-card p-4 md:gap-5 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[15px] font-semibold">Copying</b>
            <Link href={`/wallets/${sim._id}`} className="truncate text-[15px] font-semibold text-primary hover:underline">
              {sim.name} ↗
            </Link>
            <span className={cn("inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium", live ? "border-destructive/30 bg-neg-soft text-destructive" : "border-volt-line bg-volt-soft text-primary")}>
              {live ? <Zap className="size-3" /> : <FlaskConical className="size-3" />}
              {live ? "LIVE" : "Dry run"}
            </span>
            {state.paused ? <span className="inline-flex h-[22px] items-center rounded-full border border-warn/30 bg-warn-soft px-2 text-[11.5px] font-medium text-warn">Paused</span> : null}
            {!live ? <HelpTip className="ml-0">Trades are priced against the real chain and recorded. Nothing is sent.</HelpTip> : null}
          </div>
          <p className="text-[13px] leading-5 text-text-2">Inherits {rules.join(" · ")}. No execution delay.</p>
        </div>
        <div className="flex items-center gap-1.5 max-md:w-full">
          <Button
            variant={state.paused ? "default" : "outline"}
            size="sm"
            className="gap-1.5 max-md:h-10 max-md:flex-1"
            disabled={busy}
            onClick={() => apply({ paused: !state.paused }, state.paused ? "Resumed - new trades are taken again" : "Paused - no new trades. Open positions are still sold when they exit.")}
          >
            {state.paused ? <Play /> : <Pause />}
            {state.paused ? "Resume trading" : "Pause new trades"}
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-text-2 hover:text-destructive max-md:h-10" disabled={busy} onClick={() => apply({ connectedWalletId: null }, "Disconnected")}>
            <Unplug /> Disconnect
          </Button>
        </div>
      </div>

      <Field
        label="Mode"
        help={live ? (state.sendMode === "jito" ? "Real transactions are sent through Jito from this wallet." : "Real transactions are sent as plain Solana transactions from this wallet.") : "Trades are priced against the real chain and recorded, nothing is sent and nothing is spent."}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={MODES}
            value={state.tradingMode}
            label="Mode"
            className="max-md:w-full"
            block={false}
            onChange={(mode) => {
              if (busy || mode === state.tradingMode) return;
              if (mode === "live") setGoLive(true);
              else void apply({ tradingMode: "dry" }, "Back to a dry run - new trades are not sent. Positions already open are still sold for real when they exit.");
            }}
          />
          {!live ? (
            <Button variant="destructive" size="sm" className="gap-1.5 max-md:h-10" disabled={busy} onClick={() => setGoLive(true)}>
              <Rocket /> Go live…
            </Button>
          ) : null}
        </div>
      </Field>

      <Field label="Stop-loss, take-profit and trailing stops use">
        <div role="radiogroup" aria-label="Exit way" className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {exitOptions.map((o) => (
            <ExitWayCard key={o.value} label={o.label} help={o.help} on={state.exitMode === o.value} disabled={busy} tag={o.value === "follow" ? "default" : undefined} onSelect={() => o.value !== state.exitMode && void apply({ exitMode: o.value })} />
          ))}
        </div>
      </Field>

      <Group
        title="Cool-down styles"
        summary={cooldownSummary}
        help="Rides out a dip in the first minutes after a buy: only this stop-loss, a take-profit, the max hold time or a positive trailing stop can sell. After it, the profile's stop-loss and all trailing stops apply at once. Each style is worked out side by side with the other ways in a dry run."
      >
        <div className="flex flex-col gap-2.5">
          {cooldowns.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-3">Cool-down (minutes)</span>
                <Input inputMode="decimal" value={c.minutes} onChange={(e) => setCooldowns(cooldowns.map((x, j) => (j === i ? { ...x, minutes: e.target.value.replace(/[^0-9.]/g, "") } : x)))} className="w-28 text-right max-md:h-11" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-3">Stop-loss inside it (%)</span>
                <Input inputMode="decimal" value={c.stop} onChange={(e) => setCooldowns(cooldowns.map((x, j) => (j === i ? { ...x, stop: e.target.value.replace(/[^0-9.]/g, "") } : x)))} className="w-28 text-right max-md:h-11" />
              </div>
              <Button variant="ghost" size="sm" className="max-md:h-11" disabled={busy} onClick={() => setCooldowns(cooldowns.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="max-md:h-10" disabled={busy || cooldowns.length >= 6} onClick={() => setCooldowns([...cooldowns, { minutes: "3", stop: "50" }])}>
              Add a cool-down
            </Button>
            <Button size="sm" className="max-md:h-10" disabled={busy} onClick={saveCooldowns}>
              {busy ? <Loader2 className="animate-spin" /> : null} Save cool-downs
            </Button>
          </div>
        </div>
      </Group>

      <Group title="Execution" summary={execSummary} help="Slippage, the wait before a trade is built, how transactions are sent and the trade size compared with the simulation.">
        <SettingsList>
          <SaveRow
            label="Buy slippage (%)"
            htmlFor="buy-slip"
            help="How far the price may move against a trade before the program refuses it. With Jito a refused trade never lands, so no fee or tip is paid; sent raw it still pays its small network fee."
            canSave={slipChanged && Number(buySlip) >= 0}
            busy={busy}
            onSave={() => apply({ buySlippagePercent: Number(buySlip), sellSlippagePercent: state.sellSlippagePercent }, "Slippage saved")}
          >
            <Input id="buy-slip" inputMode="decimal" value={buySlip} onChange={(e) => setBuySlip(e.target.value.replace(/[^0-9.]/g, ""))} className="w-20 text-right" />
          </SaveRow>
          <SaveRow
            label="Sell slippage (%)"
            htmlFor="sell-slip"
            help="How far the price may move against a sell before it is refused."
            canSave={sellSlipChanged && Number(sellSlip) >= 0}
            busy={busy}
            onSave={() => apply({ buySlippagePercent: state.buySlippagePercent, sellSlippagePercent: Number(sellSlip) }, "Slippage saved")}
          >
            <Input id="sell-slip" inputMode="decimal" value={sellSlip} onChange={(e) => setSellSlip(e.target.value.replace(/[^0-9.]/g, ""))} className="w-20 text-right" />
          </SaveRow>
          <SaveRow
            label="Wait before a trade is built (seconds)"
            htmlFor="trade-delay"
            help={`After the simulation decides, the wallet waits this long before it prices and builds the trade (0 = at once, max ${state.maxTradeDelaySeconds}). Applies to dry run and live. The simulation waits its own ${sim.settings.executionDelaySeconds}s on this wallet - set the same here and both fill at the same moment.`}
            canSave={Number(delay) >= 0 && delay !== "" && Number(delay) !== state.tradeDelaySeconds}
            busy={busy}
            onSave={() => apply({ tradeDelaySeconds: Number(delay) }, "Wait saved")}
          >
            <Input id="trade-delay" inputMode="decimal" value={delay} onChange={(e) => setDelay(e.target.value.replace(/[^0-9.]/g, ""))} className="w-20 text-right" />
          </SaveRow>
          <SettingsRow label="Send transactions" help={state.sendMode === "jito" ? "A Jito bundle with a tip: a refused trade never lands." : "Nothing is tipped, only the network fee is paid."}>
            <Segmented<SendMode>
              options={SEND_MODES}
              value={state.sendMode}
              label="Send transactions"
              onChange={(sendMode) => !busy && sendMode !== state.sendMode && void apply({ sendMode }, sendMode === "raw" ? "Sending raw transactions - no Jito tip" : "Sending through Jito")}
            />
          </SettingsRow>
          <SaveRow
            label={state.sendMode === "jito" ? "Jito tip per transaction ($)" : "Jito fee to assume per transaction ($)"}
            htmlFor="jito-tip"
            help={
              state.sendMode === "jito"
                ? "Exactly what you enter is tipped; leave it empty to use the simulation wallet's Jito fee."
                : `Nothing is tipped; a Jito fee${state.effective ? ` (${formatUsd(state.effective.assumedTipUsd)} per transaction now)` : ""} is still counted as a cost so percentages match the simulation. A fee you enter is used as is. Left empty it is the simulation's fee, scaled down for a smaller trade size but never above it.`
            }
            canSave={tipChanged}
            busy={busy}
            onSave={() => apply({ jitoTipUsd: tip === "" ? null : Number(tip) }, "Jito fee saved")}
          >
            <Input id="jito-tip" inputMode="decimal" value={tip} placeholder={`same as simulation (${formatUsd(sim.settings.jitoFeeUsd)})`} onChange={(e) => setTip(e.target.value.replace(/[^0-9.]/g, ""))} className="w-56 max-w-full text-right" />
          </SaveRow>
          {state.sendMode === "raw" ? (
            <>
              <SaveRow
                label="Priority fee (micro-lamports per compute unit)"
                htmlFor="priority"
                canSave={priority !== "" && Number(priority) !== state.rawPriorityMicroLamports}
                busy={busy}
                onSave={() => apply({ rawPriorityMicroLamports: Number(priority) }, "Priority fee saved")}
              >
                <Input id="priority" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value.replace(/\D/g, ""))} className="w-28 text-right" />
              </SaveRow>
              <SettingsRow label="Scale the simulation's Jito fee with the trade size" help="Scale: a smaller trade gets a smaller assumed fee, never above the simulation's. Full fee: always the simulation's fee. Not used when you enter a fee above.">
                <Segmented<"on" | "off">
                  options={SCALE}
                  value={state.scaleJitoFee ? "on" : "off"}
                  label="Scale the Jito fee"
                  className={cn(state.jitoTipUsd != null && "pointer-events-none opacity-50")}
                  onChange={(v) => !busy && void apply({ scaleJitoFee: v === "on" }, v === "on" ? "The assumed Jito fee scales with the trade size" : "The assumed Jito fee is the simulation's full fee")}
                />
              </SettingsRow>
            </>
          ) : null}
          <SettingsRow
            label="Trade size, compared with the simulation"
            help={
              state.effective
                ? `The simulation trades ${formatUsd(sim.settings.tradeSizeUsd)}; this wallet trades ${formatUsd(state.effective.tradeSizeUsd)} (${state.tradeRatioSim} : ${state.tradeRatioLive}). 1 : 1 is the same dollars; 10 : 1 is a tenth of them.`
                : "1 : 1 trades the same dollars as the simulation; 10 : 1 a tenth of them."
            }
          >
            <div className="flex items-center gap-2">
              <Input aria-label="Simulation" inputMode="decimal" value={ratioSim} onChange={(e) => setRatioSim(e.target.value.replace(/[^0-9.]/g, ""))} className="w-16 text-right" />
              <span className="text-text-3">:</span>
              <Input aria-label="This wallet" inputMode="decimal" value={ratioLive} onChange={(e) => setRatioLive(e.target.value.replace(/[^0-9.]/g, ""))} className="w-16 text-right" />
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !(Number(ratioSim) > 0) || !(Number(ratioLive) > 0) || (Number(ratioSim) === state.tradeRatioSim && Number(ratioLive) === state.tradeRatioLive)}
                onClick={() => apply({ tradeRatioSim: Number(ratioSim), tradeRatioLive: Number(ratioLive) }, "Trade size saved")}
              >
                Save
              </Button>
            </div>
          </SettingsRow>
        </SettingsList>
      </Group>

      {state.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}

      <GoLiveDialog open={goLive} onOpenChange={setGoLive} walletId={walletId} state={state} summary={summary} funding={funding} onDone={onChange} onLookupChanged={onRefresh} />
    </section>
  );
}
