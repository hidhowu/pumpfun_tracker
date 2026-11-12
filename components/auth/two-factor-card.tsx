"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/dialog-parts";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";

type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number; available: boolean };
type Setup = { secret: string; otpauthUrl: string; qrSvg: string };

async function post<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-4">
      <b className="text-sm font-semibold">Save these recovery codes now</b>
      <p className="text-xs leading-[18px] text-text-2">
        Each code works once, in place of an authenticator code, if you lose your phone. They are shown only this one time - store them somewhere safe and separate from your password.
      </p>
      <div className="grid max-w-[360px] grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[13px]">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:h-11 max-md:flex-1"
          onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Recovery codes copied"))}
        >
          <Copy /> Copy
        </Button>
        <Button type="button" size="sm" className="max-md:h-11 max-md:flex-1" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

export function TwoFactorCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"idle" | "disable" | "recovery">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/2fa");
      if (res.ok) setStatus(await res.json());
    } catch {
      /* the card just stays in its loading state */
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/2fa")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setStatus(body))
      .catch(() => {
        /* the card just stays in its loading state */
      });
  }, []);

  function reset() {
    setPassword("");
    setCode("");
    setError(null);
    setMode("idle");
    setSetup(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const startSetup = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSetup(await post<Setup>("/api/auth/2fa/setup", { password }));
      setPassword("");
    });
  };

  const finishSetup = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await post<{ recoveryCodes: string[] }>("/api/auth/2fa/enable", { code });
      setRecoveryCodes(result.recoveryCodes);
      reset();
      await load();
      toast.success("Two-factor sign-in is on - every other browser was signed out");
    });
  };

  const disable = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await post("/api/auth/2fa/disable", { password, code });
      reset();
      await load();
      toast.success("Two-factor sign-in is off");
    });
  };

  const regenerate = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await post<{ recoveryCodes: string[] }>("/api/auth/2fa/recovery", { password, code });
      setRecoveryCodes(result.recoveryCodes);
      reset();
      await load();
    });
  };

  const errorLine = error ? (
    <p role="alert" className="text-[13px] text-destructive">
      {error}
    </p>
  ) : null;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-[20px] border border-border bg-card p-4 md:p-6">
      <h2 className="flex items-center gap-2 text-[17px] leading-6 font-semibold">
        {status?.enabled ? <ShieldCheck className="size-[18px] text-primary" /> : <ShieldOff className="size-[18px] text-text-3" />}
        <span>
          Two-factor sign-in
          <HelpTip>Asks for a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password...) after your password, so a stolen or guessed password alone is not enough.</HelpTip>
        </span>
      </h2>

      {recoveryCodes && <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />}

      {!status && <p className="text-sm text-text-3">Loading…</p>}

      {status && !status.enabled && !setup && (
        <form onSubmit={startSetup} className="flex flex-col gap-4">
          <p className="text-sm text-text-2">
            Currently <b className="font-semibold text-foreground">off</b>. Confirm your password to set it up.
          </p>
          <Field label="Password" htmlFor="tf-password" className="md:max-w-xs">
            <Input id="tf-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className="max-md:h-11" />
          </Field>
          {!status.available && <p className="text-[13px] text-destructive">This server has no TOTP_ENCRYPTION_KEY set, so two-factor can&apos;t be turned on yet (see .env.example).</p>}
          {errorLine}
          <div>
            <Button type="submit" disabled={busy || !status.available} className="max-md:h-11 max-md:w-full">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Working…" : "Set up two-factor"}
            </Button>
          </div>
        </form>
      )}

      {status && !status.enabled && setup && (
        <form onSubmit={finishSetup} className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="QR code for your authenticator app"
              width={176}
              height={176}
              className="shrink-0 self-center rounded-xl bg-white p-2"
              src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 text-sm">
              <p>1. Scan this with your authenticator app, or enter the key by hand:</p>
              <code className="rounded-xl border border-border bg-surface-2 px-3 py-2 font-mono text-xs break-all">{setup.secret}</code>
              <p>2. Type the 6-digit code the app shows to finish:</p>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="123456"
                aria-label="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="font-mono tracking-[0.3em] max-md:h-[52px] max-md:text-center max-md:text-2xl max-md:font-semibold max-md:tracking-[0.5em] md:max-w-40"
              />
            </div>
          </div>
          {errorLine}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6} className="max-md:h-11 max-md:flex-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Checking…" : "Turn on"}
            </Button>
            <Button type="button" variant="ghost" onClick={reset} className="max-md:h-11 max-md:flex-1">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {status?.enabled && mode === "idle" && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-2">
            Currently <b className="font-semibold text-foreground">on</b>
            {status.enabledAt ? ` since ${new Date(status.enabledAt).toLocaleDateString()}` : ""}. Recovery codes left: <b className="font-semibold text-foreground">{status.recoveryCodesRemaining}</b>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setMode("recovery")} className="max-md:h-11 max-md:flex-1">
              New recovery codes
            </Button>
            <Button type="button" variant="outline" onClick={() => setMode("disable")} className="max-md:h-11 max-md:flex-1">
              Turn off
            </Button>
          </div>
        </div>
      )}

      {status?.enabled && mode !== "idle" && (
        <form onSubmit={mode === "disable" ? disable : regenerate} className="flex flex-col gap-4">
          <p className="text-sm text-text-2">
            {mode === "disable" ? "Turning it off needs your password and a current code." : "The old recovery codes stop working. Confirm with your password and a current code."}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Password" htmlFor="tf-password2">
              <Input id="tf-password2" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className="max-md:h-11" />
            </Field>
            <Field label="Authenticator or recovery code" htmlFor="tf-code2">
              <Input id="tf-code2" autoComplete="one-time-code" required maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono max-md:h-11" />
            </Field>
          </div>
          {errorLine}
          <div className="flex gap-2">
            <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} disabled={busy} className="max-md:h-11 max-md:flex-1">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Working…" : mode === "disable" ? "Turn off two-factor" : "Generate new codes"}
            </Button>
            <Button type="button" variant="ghost" onClick={reset} className="max-md:h-11 max-md:flex-1">
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
