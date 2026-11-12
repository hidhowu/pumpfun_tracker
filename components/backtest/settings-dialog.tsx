"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, Settings2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsList, SettingsRow } from "@/components/ui/settings-row";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { getBacktestSettings, updateBacktestSettings } from "@/lib/backtest-api";
import type { BacktestSettingsView, BacktestStoredSettings } from "@/lib/backtest-types";
import { cn } from "@/lib/utils";
import { DialogHead, Notice } from "./dialog-parts";

type AutoField = "addressParallelism" | "txParallelismPerAddress" | "positionParallelism" | "rpcRpsPerEndpoint" | "proxyRps";
type FixedField = "sharedRpcFraction" | "userTradesRps" | "fillLatencySeconds" | "directRps" | "minSolAmount" | "initialWindowSeconds" | "maxPagesPerPosition";

const AUTO_FIELDS: Array<{ key: AutoField; label: string; help: string }> = [
  { key: "addressParallelism", label: "Addresses at the same time", help: "How many addresses are worked on in parallel." },
  { key: "txParallelismPerAddress", label: "Transactions at once, per address", help: "Parallel transaction fetches for one address while collecting." },
  { key: "positionParallelism", label: "Trades at once (all addresses)", help: "How many trades are simulated at the same time, shared by every address - auto is one per proxy. An address whose profile forbids a negative balance works through its own trades one by one." },
  { key: "rpcRpsPerEndpoint", label: "RPC requests / second, per endpoint", help: "Rate cap on each backtest-only RPC. Set it to what your provider allows." },
  { key: "proxyRps", label: "pump.fun requests / second, per proxy", help: "Each proxy is a separate IP with its own limit - about 1/s is sustainable." },
];

const FIXED_FIELDS: Array<{ key: FixedField; label: string; help: string; step?: string }> = [
  { key: "sharedRpcFraction", label: "Share of speed on live RPCs (0.05 – 1)", help: "RPCs set to \"Live + backtests\" run at this fraction of the rate above, so live trading is never starved.", step: "0.05" },
  { key: "userTradesRps", label: "Trade-history requests / second, per proxy", help: "Reading an address's own trades (the fast source) goes through the same proxies. pump.fun allows about 10/s per IP on that endpoint.", step: "0.5" },
  { key: "fillLatencySeconds", label: "Extra reaction time on every copied trade (seconds)", help: "Default for new backtests: how long live takes, on top of the profile's delay, to notice a trader's trade and act on it (about 3s measured). It can be changed per backtest when creating one. 0 = react instantly.", step: "0.5" },
  { key: "directRps", label: "Requests / second with no proxies", help: "Used only when no proxy is configured - direct requests from this machine's own IP.", step: "0.1" },
  { key: "minSolAmount", label: "Ignore pool trades under (SOL)", help: "Smaller trades barely move the price and make histories much longer. Applied exactly here, and passed to pump.fun as a USD floor so most of them are never downloaded.", step: "0.01" },
  { key: "initialWindowSeconds", label: "First look-ahead window (seconds)", help: "Trade history is read in windows of this size, then resized to how busy the token is." },
  { key: "maxPagesPerPosition", label: "Give up on a trade after (pages of 100)", help: "Safety cap for tokens with an extreme number of trades while held." },
];

type FormState = {
  auto: Record<AutoField, boolean>;
  values: Record<AutoField | FixedField, string>;
  program: string;
};

function toForm(view: BacktestSettingsView): FormState {
  const auto = {} as Record<AutoField, boolean>;
  const values = {} as FormState["values"];
  for (const { key } of AUTO_FIELDS) {
    auto[key] = view.stored[key] === null;
    values[key] = String(view.stored[key] ?? view.effective[key]);
  }
  for (const { key } of FIXED_FIELDS) values[key] = String(view.stored[key]);
  return { auto, values, program: view.stored.program };
}

/** Backtest speed/limits. Everything marked Auto follows the number of proxies and RPCs you have, so adding more speeds backtests up with no tuning. */
export function BacktestSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BacktestSettingsView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await getBacktestSettings();
      setView(v);
      setForm(toForm(v));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load backtest settings");
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function save() {
    if (!form) return;
    const patch: Partial<Record<keyof BacktestStoredSettings, number | string | null>> = { program: form.program.trim() };
    for (const { key, label } of AUTO_FIELDS) {
      if (form.auto[key]) patch[key] = null;
      else {
        const n = Number(form.values[key]);
        if (!Number.isFinite(n) || n <= 0) return void toast.error(`${label}: enter a positive number`);
        patch[key] = n;
      }
    }
    for (const { key, label } of FIXED_FIELDS) {
      const n = Number(form.values[key]);
      if (!Number.isFinite(n) || n < 0 || (key !== "minSolAmount" && key !== "fillLatencySeconds" && n === 0)) return void toast.error(`${label}: enter a valid number`);
      if (key === "sharedRpcFraction" && (n < 0.05 || n > 1)) return void toast.error("Share of speed on live RPCs must be between 0.05 and 1");
      patch[key] = n;
    }
    setSaving(true);
    try {
      await updateBacktestSettings(patch);
      toast.success("Backtest settings saved - applied within seconds");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const cap = view?.capacity;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <Settings2 className="size-4" />
          Backtest settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHead
          icon={<SlidersHorizontal className="size-5" />}
          title="Backtest settings"
          help={'How hard backtests run. "Auto" is worked out from your proxies and RPC endpoints, so the more you add the faster it goes.'}
          description="Capacity, the automatic limits and the fixed values of the backtest engine."
        />

        {!view || !form ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface-2 px-4 py-3.5">
              <span className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Current capacity</span>
              <span className="text-[13px] leading-5 text-text-2">
                {cap!.proxies} {cap!.proxies === 1 ? "proxy" : "proxies"} → about {cap!.pumpCapacityRps.toFixed(1)} pump.fun requests/s · {cap!.rpcDedicated} backtest-only RPC
                {cap!.rpcDedicated === 1 ? "" : "s"} + {cap!.rpcShared} shared → about {cap!.rpcCapacityRps.toFixed(1)} RPC requests/s
              </span>
            </div>
            {cap!.proxies === 0 && <Notice>No proxies configured: pump.fun allows only about 1 request/s per IP, so backtests will be slow. Add proxies on the Proxies page.</Notice>}
            {cap!.rpcDedicated === 0 && <Notice>No backtest-only RPCs: backtests only borrow a small share of your live RPCs. Add RPCs on the RPC page and set them to &quot;Backtests only&quot;.</Notice>}

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Auto limits</span>
              <SettingsList>
                {AUTO_FIELDS.map(({ key, label, help }) => (
                  <SettingsRow key={key} label={label} help={`${help}${form.auto[key] ? ` Auto is using ${view.effective[key]} now.` : ""}`} htmlFor={`bt-${key}`}>
                    <div className="flex items-center gap-3">
                      <Input
                        id={`bt-${key}`}
                        inputMode="decimal"
                        disabled={form.auto[key]}
                        value={form.auto[key] ? String(view.effective[key]) : form.values[key]}
                        onChange={(e) => setForm({ ...form, values: { ...form.values, [key]: e.target.value } })}
                        className="w-[88px] text-right"
                      />
                      <label className="flex items-center gap-2 text-xs text-text-2">
                        Auto
                        <Switch checked={form.auto[key]} onCheckedChange={(v) => setForm({ ...form, auto: { ...form.auto, [key]: v } })} aria-label={`Auto ${label}`} />
                      </label>
                    </div>
                  </SettingsRow>
                ))}
              </SettingsList>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-surface-2">
              <button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left">
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-sm font-semibold">More limits</b>
                  <span className="text-xs text-text-3">7 fixed values and the venue filter - speed share, history rates, reaction time, pool-trade floor, look-ahead, page cap</span>
                </span>
                <ChevronDown className={cn("size-4 shrink-0 text-text-3 transition-transform", moreOpen && "rotate-180")} />
              </button>
              {moreOpen && (
                <div className="flex flex-col gap-2 border-t border-border p-4">
                  <span className="text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase">Fixed values</span>
                  <SettingsList>
                    {FIXED_FIELDS.map(({ key, label, help }) => (
                      <SettingsRow key={key} label={label} help={help} htmlFor={`bt-${key}`}>
                        <Input
                          id={`bt-${key}`}
                          inputMode="decimal"
                          value={form.values[key]}
                          onChange={(e) => setForm({ ...form, values: { ...form.values, [key]: e.target.value } })}
                          className="w-[110px] text-right"
                        />
                      </SettingsRow>
                    ))}
                    <SettingsRow label="pump.fun venue filter" help={'"pump" asks only for bonding-curve trades (the venue parameter). Anything else, or empty, asks for all venues.'} htmlFor="bt-program">
                      <Input id="bt-program" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className="w-[110px] text-right" placeholder="pump" />
                    </SettingsRow>
                  </SettingsList>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={saving || !form}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
