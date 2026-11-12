"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Coins, Filter, Loader2, Radio, RotateCcw, ShieldAlert, Timer, TriangleAlert, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionNav, type SectionNavItem } from "@/components/ui/section-nav";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TrailingStopsEditor } from "@/components/trailing-stops-editor";
import { NoPriceExits } from "@/components/wallets/no-price-exits";
import { Section, ToggleRow } from "@/components/settings/parts";
import { resetWallet, resetWalletBalance, updateWalletSettings } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PriceSource, TrailingStop, WalletSettings, WalletView } from "@/lib/types";

type Props = {
  walletId: string;
  settings: WalletSettings;
  lastAutoResetAt?: string | null;
  onUpdated: (settings: WalletSettings, wallet?: WalletView) => void;
  onReset?: (wallet: WalletView) => void;
};

type Tracking = NonNullable<WalletSettings["trackingMethod"]>;

/** What a price source is when the wallet has not chosen one: it follows the tracking method (the same rule as priceSources() in db/simulation/apiPlus.js). */
const defaultPriceSource = (trackingMethod: WalletSettings["trackingMethod"]): PriceSource => (trackingMethod === "api" ? "sdk" : "api");

const PRICE_SOURCE_ROWS: { key: "buyPriceSource" | "checkPriceSource" | "exitPriceSource"; label: string; help?: string; subtitle?: string }[] = [
  { key: "buyPriceSource", label: "Buy price", subtitle: "The price a simulated buy fills at." },
  {
    key: "checkPriceSource",
    label: "Interval price check",
    help: "The price the stop-loss, take-profit and trailing stops are judged on, every risk-check interval. Fixed for a position when it opens - a change applies from the next buy.",
  },
  { key: "exitPriceSource", label: "Final sell price", help: "The price a sale fills at - the trader's own sell, or an exit this wallet decided." },
];

const SOURCES = [
  { value: "sdk", label: "pump SDK" },
  { value: "api", label: "Local API" },
] as const;

const METHODS: { value: Tracking; title: string; subtitle: string; help?: string }[] = [
  { value: "logs", title: "RPC logs", subtitle: "Spot price + pump fee" },
  { value: "api", title: "pump.fun API", subtitle: "Polled several times a second" },
  { value: "api_plus", title: "pump.fun API+", subtitle: "Backtest-exact pool pricing" },
  { value: "grpc", title: "gRPC", subtitle: "Yellowstone push, no proxies" },
];

const METHOD_HELP: Record<Tracking, string> = {
  grpc: "Traders are followed over Yellowstone gRPC by the standalone tracking server, which pushes each of their trades to the tracker the moment it lands - no pump.fun API, no proxies. Where the prices come from is set below under Price sources - by default (like pump.fun API+) every price comes from the token's own trade list (also served by the tracking server), checked at the backtest's moments; the pump SDK can be picked for any of the three instead. The pump fee below is charged on every buy, and on a sale unless it is priced by an SDK quote (its fee is already inside).",
  api_plus:
    "Traders are detected through pump.fun's user-trades API like \"pump.fun API\", but every price comes from the token's own trade list, checked exactly the way a backtest checks it: a buy fills at the pool price when it is due, the stop-loss / take-profit / trailing stops are judged on the pool price at fixed moments (every risk-check interval from the fill), and an exit fills the execution delay after the moment it was decided. A run here and a backtest of the same trade agree. The pump fee below is charged on buys and sells. A connected live wallet that follows this wallet's exits gets the same exits; its own exit styles use the same price.",
  api: "This wallet's traders are polled through pump.fun's user-trades API several times a second (rate set in Profile settings). Every fill and every stop-loss / take-profit check uses pump.fun's SDK quote - the quote already contains pump.fun's fee, so the pump fee below is not charged again. Traders who are also in a logs wallet keep being tracked by the logs for that wallet.",
  logs: "This wallet's traders are followed through the tracker's RPC log subscription, and priced at the token's spot price plus the pump fee below.",
};

const SECTIONS: SectionNavItem[] = [
  { id: "ws-detection", label: "Trade detection", icon: Radio },
  { id: "ws-prices", label: "Price sources", icon: Coins },
  { id: "ws-balance", label: "Balance", icon: RotateCcw },
  { id: "ws-size", label: "Trade size & fee", icon: WalletIcon },
  { id: "ws-filters", label: "Buy / sell filters", icon: Filter },
  { id: "ws-risk", label: "Risk", icon: ShieldAlert },
  { id: "ws-execution", label: "Execution", icon: Timer },
  { id: "ws-danger", label: "Danger zone", icon: TriangleAlert, danger: true },
];

/** A number that saves as you leave the field (blur or Enter), without being reset by the page's polling while you type. */
function SaveField({
  id,
  label,
  help,
  value,
  onSave,
  prefix,
  suffix,
  step = 1,
  min,
  max,
  className,
}: {
  id: string;
  label: string;
  help?: string;
  value: number;
  onSave: (value: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const dirty = draft !== String(value);

  useEffect(() => {
    // Without this guard the wallet page's 10 s poll would reset whatever is being typed before it is committed.
    if (!dirty) setDraft(String(value));
  }, [value, dirty]);

  function commit() {
    const num = Number(draft);
    if (!Number.isFinite(num) || draft.trim() === "") {
      setDraft(String(value));
      return;
    }
    if (num !== value) onSave(num);
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </Label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-3">{prefix}</span>}
        <Input
          id={id}
          type="number"
          step={step}
          min={min}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className={cn("max-md:h-11", prefix && "pl-7", suffix && "pr-12")}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-text-3">{suffix}</span>}
      </div>
    </div>
  );
}

/** Stop-loss / take-profit: a switch row with the level beside it while it is on. */
function LevelToggle({ title, level, enabledDefault, onChange }: { title: string; level: number | null; enabledDefault: number; onChange: (next: number | null) => void }) {
  const on = level !== null;
  return (
    <ToggleRow title={title} status={on ? `${level}%` : "Disabled"}>
      <div className="flex items-center gap-2.5">
        {on && (
          <div className="relative w-[92px]">
            <Input
              type="number"
              step={5}
              min={1}
              aria-label={`${title} percent`}
              className="h-8 rounded-lg pr-6 text-[13px] md:text-[13px]"
              defaultValue={level ?? undefined}
              key={level}
              onBlur={(e) => {
                const num = Number(e.target.value);
                if (Number.isFinite(num) && num !== level) onChange(num);
              }}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-text-3">%</span>
          </div>
        )}
        <Switch aria-label={title} checked={on} onCheckedChange={(checked) => onChange(checked ? enabledDefault : null)} />
      </div>
    </ToggleRow>
  );
}

/** Stages trailing-stop edits locally and only saves (one API call) when "Save rules" is clicked - TrailingStopsEditor's onChange fires on every keystroke, so wiring it straight to a network save would fire one request per character typed. */
function TrailingStopsSection({ trailingStops, onSave }: { trailingStops: TrailingStop[]; onSave: (rules: TrailingStop[]) => void }) {
  const [draft, setDraft] = useState<TrailingStop[]>(trailingStops);
  const dirty = JSON.stringify(draft) !== JSON.stringify(trailingStops);

  useEffect(() => {
    // Only pull in the server's list while there's nothing unsaved locally - the wallet page polls every 10 s, and without this guard
    // that poll's fresh (but otherwise unchanged) array reference would wipe out an in-progress edit before Save is ever clicked.
    if (!dirty) setDraft(trailingStops);
  }, [trailingStops, dirty]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col">
        <b className="text-[13px] font-semibold">
          Trailing stops
          <HelpTip>Once a position reaches &quot;arm at&quot; it auto-sells if it falls back to &quot;exit at&quot;. Whichever rule triggers first closes the position.</HelpTip>
        </b>
        <span className="text-xs text-text-3">
          {trailingStops.length} rule{trailingStops.length === 1 ? "" : "s"}
        </span>
      </div>
      <TrailingStopsEditor
        value={draft}
        onChange={setDraft}
        actions={
          dirty ? (
            <>
              <Button size="sm" onClick={() => onSave(draft)}>
                Save rules
              </Button>
              <span className="text-xs text-warn">unsaved edits</span>
            </>
          ) : null
        }
      />
    </div>
  );
}

/** 00:00 UTC expressed in the viewer's own clock, e.g. "01:00". */
const localResetTime = new Date(Date.UTC(2000, 0, 1)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * A wallet's own flat settings form - unlike TraderSettingsPanel, there's no
 * override-vs-inherited-default dance here: a wallet has exactly ONE
 * settings object (independent of every Profile/trader), so every field is
 * a direct value that saves immediately.
 */
export function WalletSettingsPanel({ walletId, settings, lastAutoResetAt, onUpdated, onReset }: Props) {
  const [resettingFull, setResettingFull] = useState(false);
  const [resettingBalance, setResettingBalance] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  async function save(patch: Partial<WalletSettings>) {
    try {
      const { wallet } = await updateWalletSettings(walletId, patch);
      onUpdated(wallet.settings, wallet);
      toast.success("Wallet setting updated");
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update setting");
    }
  }

  async function handleReset() {
    setResettingFull(true);
    try {
      const { wallet } = await resetWallet(walletId);
      onReset?.(wallet);
      toast.success("Wallet reset - balance back to starting balance, trade history cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset wallet");
    } finally {
      setResettingFull(false);
    }
  }

  async function handleResetBalance() {
    setResettingBalance(true);
    try {
      const { wallet } = await resetWalletBalance(walletId);
      onReset?.(wallet);
      toast.success("Balance reset - trade history and P&L untouched");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset balance");
    } finally {
      setResettingBalance(false);
    }
  }

  const trackingMethod: Tracking = settings.trackingMethod ?? "logs";
  const showNoPrice = trackingMethod === "grpc" || trackingMethod === "api_plus";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-[14px] border border-info/30 bg-info-soft px-4 py-3 text-[13px] leading-5 text-[#c7e2ff]">
        <HelpTip className="ml-0">Independent of any Profile or trader. Applies to every trade this wallet takes. Each field saves as you leave it.</HelpTip>
        <span className="min-w-0 flex-1">Wallet settings save as you leave each field.</span>
        {saved && (
          <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-positive/30 bg-pos-soft px-2 text-[11.5px] font-medium text-positive max-sm:hidden">
            <Check className="size-3" /> Wallet setting updated
          </span>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <SectionNav items={SECTIONS} />

        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <Section id="ws-detection" icon={Radio} title="Trade detection" subtitle="How this wallet's traders are followed">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4" role="radiogroup" aria-label="Trade detection">
              {METHODS.map((m) => {
                const on = trackingMethod === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => !on && save({ trackingMethod: m.value })}
                    className={cn(
                      "flex min-h-[68px] flex-col items-start justify-center gap-0.5 rounded-[14px] border px-3.5 py-3 text-left transition-colors",
                      on ? "border-primary bg-volt-soft" : "border-border bg-surface-2 hover:border-line-3"
                    )}
                  >
                    <b className={cn("text-[13px] font-semibold", on && "text-primary")}>{m.title}</b>
                    <span className="text-xs text-text-3">{m.subtitle}</span>
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-text-3">
              {METHODS.find((m) => m.value === trackingMethod)?.title}
              <HelpTip>{METHOD_HELP[trackingMethod]}</HelpTip>
            </span>
          </Section>

          <Section
            id="ws-prices"
            icon={Coins}
            title="Price sources"
            help="pump SDK quotes what pump.fun / PumpSwap would pay right now - any token on a curve or in a PumpSwap pool can be priced at once, nothing needs to be tracked first. Local API reads the token's own trade list from the gRPC tracking server (the pool price at the backtest's moments, so a run here and a backtest agree); the server follows a token from the moment a tracked wallet buys it, so the very first price can take a few seconds. The three are independent: for example buy with the SDK, check on the Local API, sell with the SDK."
           
          >
            {trackingMethod === "logs" ? (
              <div className="rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-xs leading-[18px] text-text-2">
                A wallet following through RPC logs fills and checks at spot - switch detection to pump.fun API, API+ or gRPC to choose price sources.
              </div>
            ) : (
              <div className="flex flex-col rounded-xl border border-line bg-card px-3.5 [&>*+*]:border-t [&>*+*]:border-line">
                {PRICE_SOURCE_ROWS.map((row) => (
                  <div key={row.key} className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
                    <div className="flex min-w-0 flex-col">
                      <b className="text-[13px] font-semibold">
                        {row.label}
                        {row.help ? <HelpTip>{row.help}</HelpTip> : null}
                      </b>
                      {row.subtitle ? <span className="text-xs text-text-3">{row.subtitle}</span> : null}
                    </div>
                    <Segmented
                      options={SOURCES}
                      value={settings[row.key] ?? defaultPriceSource(trackingMethod)}
                      onChange={(value) => save({ [row.key]: value })}
                      label={row.label}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          {showNoPrice && (
            <Section icon={TriangleAlert} title="Positions no price could be found for" subtitle="shown for gRPC and API+ wallets">
              <NoPriceExits walletId={walletId} />
            </Section>
          )}

          <Section id="ws-balance" icon={RotateCcw} title="Balance">
            <ToggleRow
              title={
                <>
                  Reset balance every day
                  <HelpTip>At 00:00 UTC ({localResetTime} your time) the balance returns to the starting balance. Positions, history and P&amp;L are untouched. Turning it on takes effect from the next reset.</HelpTip>
                </>
              }
              status={settings.autoResetBalanceDaily ? `Last automatic reset: ${lastAutoResetAt ? new Date(lastAutoResetAt).toLocaleString() : "not yet"}` : undefined}
            >
              <Switch aria-label="Reset balance every day" checked={settings.autoResetBalanceDaily} onCheckedChange={(checked) => save({ autoResetBalanceDaily: checked })} />
            </ToggleRow>
            <ToggleRow title="Reset balance now" status="Sets the balance back to the starting balance now. Positions and history are untouched.">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={resettingBalance} className="gap-1.5">
                    {resettingBalance ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Reset balance
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset this wallet&apos;s balance?</AlertDialogTitle>
                    <AlertDialogDescription>Balance returns to the starting balance. Positions, history and P&amp;L stay.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleResetBalance}>Reset balance</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </ToggleRow>
          </Section>

          <Section id="ws-size" icon={WalletIcon} title="Trade size & fee">
            <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
              <SaveField id="w-tradeSize" label="Trade size" help="USD spent per simulated buy on this wallet - independent of the trader's own trade size." prefix="$" step={5} min={0} value={settings.tradeSizeUsd} onSave={(v) => save({ tradeSizeUsd: v })} />
              <div className="hidden sm:block" />
              <SaveField
                id="w-pumpFee"
                label="Pump fee"
                help="% of trade value on every buy and sell (0.95% protocol + 0.30% creator). Max 2%."
                suffix="%"
                step={0.05}
                min={0}
                max={2}
                value={settings.pumpFeePercent ?? 1.25}
                onSave={(v) => save({ pumpFeePercent: v })}
              />
              <SaveField
                id="w-jitoFee"
                label="Jito fee per transaction"
                help="Flat USD to land each buy and sell (Jito tip + priority fee). Max $1."
                prefix="$"
                step={0.01}
                min={0}
                max={1}
                value={settings.jitoFeeUsd ?? 0}
                onSave={(v) => save({ jitoFeeUsd: v })}
              />
            </div>
          </Section>

          <Section id="ws-filters" icon={Filter} title="Buy / sell filters">
            <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
              <SaveField id="w-dustBuy" label="Dust-buy threshold" help="Ignore a trader's buy below this USD value." prefix="$" step={5} min={0} value={settings.dustBuyUsd} onSave={(v) => save({ dustBuyUsd: v })} />
              <SaveField
                id="w-dustSell"
                label="Dust-sell fraction"
                help="Ignore a sell under this % of the trader's total bought amount."
                suffix="%"
                step={1}
                min={0}
                value={settings.dustSellFractionPercent}
                onSave={(v) => save({ dustSellFractionPercent: v })}
              />
            </div>
          </Section>

          <Section id="ws-risk" icon={ShieldAlert} title="Risk">
            <div className="grid gap-3 md:grid-cols-2 md:gap-4">
              <LevelToggle title="Stop-loss" level={settings.stopLossPercent} enabledDefault={60} onChange={(next) => save({ stopLossPercent: next })} />
              <LevelToggle title="Take-profit" level={settings.takeProfitPercent} enabledDefault={80} onChange={(next) => save({ takeProfitPercent: next })} />
            </div>
            <SaveField
              id="w-maxTradeTime"
              label="Max trade time"
              help="0 = no limit. 30 force-sells after 30 minutes if the trader still hasn't sold."
              suffix="min"
              step={5}
              min={0}
              value={settings.maxTradeTimeSeconds / 60}
              onSave={(v) => save({ maxTradeTimeSeconds: Math.max(0, v) * 60 })}
              className="md:max-w-[340px]"
            />
            <TrailingStopsSection trailingStops={settings.trailingStops} onSave={(rules) => save({ trailingStops: rules })} />
            <SaveField
              id="w-panic"
              label="Panic level (loss)"
              help="0 = off. How deep a loss stretch this wallet may reach before you should panic - e.g. if the backtest's deepest point was $100, enter 150. The wallet shows a bar that fills green, yellow, red as the loss since its highest point approaches this, and turns red when it reaches it. Only closed trades count, and it never stops or changes a trade."
              prefix="$"
              step={10}
              min={0}
              value={settings.panicLossUsd ?? 0}
              onSave={(v) => save({ panicLossUsd: v !== 0 ? Math.abs(v) : null })}
              className="md:max-w-[520px]"
            />
          </Section>

          <Section id="ws-execution" icon={Timer} title="Execution">
            <SaveField
              id="w-delay"
              label="Execution delay"
              help="Simulated latency before this wallet's fill."
              suffix="sec"
              step={0.5}
              min={0}
              value={settings.executionDelaySeconds}
              onSave={(v) => save({ executionDelaySeconds: v })}
              className="md:max-w-[340px]"
            />
          </Section>

          <Section id="ws-danger" icon={TriangleAlert} title="Danger zone" tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <b className="text-[13px] font-semibold">Reset wallet</b>
                <span className="max-w-[520px] text-xs text-text-3">Wipes every position and history and resets the balance. Settings and traders stay.</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="lg" disabled={resettingFull} className="gap-1.5 md:h-9 md:rounded-[10px] md:px-3.5 md:text-[13px]">
                    {resettingFull ? <Loader2 className="animate-spin" /> : <RotateCcw className="size-3.5" />}
                    Reset…
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset this wallet&apos;s simulation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Wipes every position and trade history back to the starting balance. Settings and traders stay. Cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={handleReset}>
                      Reset wallet
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
