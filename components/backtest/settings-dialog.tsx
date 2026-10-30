"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getBacktestSettings, updateBacktestSettings } from "@/lib/backtest-api";
import type { BacktestSettingsView, BacktestStoredSettings } from "@/lib/backtest-types";

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
      <DialogContent className="flex max-h-[90vh] flex-col overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Backtest settings</DialogTitle>
          <DialogDescription>
            How hard backtests run. &quot;Auto&quot; is worked out from your proxies and RPC endpoints, so the more you add the faster it goes.
          </DialogDescription>
        </DialogHeader>

        {!view || !form ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <p className="font-medium">Current capacity</p>
              <p className="mt-1 text-muted-foreground">
                {cap!.proxies} {cap!.proxies === 1 ? "proxy" : "proxies"} → about {cap!.pumpCapacityRps.toFixed(1)} pump.fun requests/s · {cap!.rpcDedicated} backtest-only RPC
                {cap!.rpcDedicated === 1 ? "" : "s"} + {cap!.rpcShared} shared → about {cap!.rpcCapacityRps.toFixed(1)} RPC requests/s
              </p>
              {cap!.proxies === 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  No proxies configured: pump.fun allows only about 1 request/s per IP, so backtests will be slow. Add proxies on the Proxies page.
                </p>
              )}
              {cap!.rpcDedicated === 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  No backtest-only RPCs: backtests only borrow a small share of your live RPCs. Add RPCs on the RPC page and set them to &quot;Backtests only&quot;.
                </p>
              )}
            </div>

            {AUTO_FIELDS.map(({ key, label, help }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`bt-${key}`}>{label}</Label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Auto
                    <Switch checked={form.auto[key]} onCheckedChange={(v) => setForm({ ...form, auto: { ...form.auto, [key]: v } })} aria-label={`Auto ${label}`} />
                  </label>
                </div>
                <Input
                  id={`bt-${key}`}
                  inputMode="decimal"
                  disabled={form.auto[key]}
                  value={form.auto[key] ? String(view.effective[key]) : form.values[key]}
                  onChange={(e) => setForm({ ...form, values: { ...form.values, [key]: e.target.value } })}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">
                  {help}
                  {form.auto[key] ? ` Auto is using ${view.effective[key]} right now.` : ""}
                </p>
              </div>
            ))}

            {FIXED_FIELDS.map(({ key, label, help }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`bt-${key}`}>{label}</Label>
                <Input
                  id={`bt-${key}`}
                  inputMode="decimal"
                  value={form.values[key]}
                  onChange={(e) => setForm({ ...form, values: { ...form.values, [key]: e.target.value } })}
                  className="w-32"
                />
                <p className="text-xs text-muted-foreground">{help}</p>
              </div>
            ))}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bt-program">pump.fun venue filter</Label>
              <Input id="bt-program" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} className="w-32" placeholder="pump" />
              <p className="text-xs text-muted-foreground">&quot;pump&quot; asks only for bonding-curve-program trades (the venue parameter); anything else, or empty, asks for all venues.</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={saving || !form}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
