"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ShieldCheck, ShieldOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-col gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4">
      <p className="text-sm font-medium">Save these recovery codes now</p>
      <p className="text-xs text-muted-foreground">
        Each code works once, in place of an authenticator code, if you lose your phone. They are shown only this one time - store
        them somewhere safe and separate from your password.
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Recovery codes copied"))}
        >
          <Copy /> Copy
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {status?.enabled ? <ShieldCheck className="size-4 text-primary" /> : <ShieldOff className="size-4 text-muted-foreground" />}
          Two-factor sign-in
        </CardTitle>
        <CardDescription>
          Asks for a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password...) after your password, so a stolen or guessed password alone is not
          enough.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {recoveryCodes && <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />}

        {!status && <p className="text-sm text-muted-foreground">Loading…</p>}

        {status && !status.enabled && !setup && (
          <form onSubmit={startSetup} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Currently <span className="font-medium text-foreground">off</span>. Confirm your password to set it up.</p>
            {!status.available && (
              <p className="text-sm text-negative">This server has no TOTP_ENCRYPTION_KEY set, so two-factor can&apos;t be turned on yet (see .env.example).</p>
            )}
            <div className="flex max-w-xs flex-col gap-1.5">
              <Label htmlFor="tf-password">Password</Label>
              <Input id="tf-password" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-sm text-negative">{error}</p>}
            <div>
              <Button type="submit" disabled={busy || !status.available}>
                {busy ? "Working…" : "Set up two-factor"}
              </Button>
            </div>
          </form>
        )}

        {status && !status.enabled && setup && (
          <form onSubmit={finishSetup} className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="QR code for your authenticator app"
                width={176}
                height={176}
                className="rounded-md border border-border bg-white p-1"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
              />
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <p>1. Scan this with your authenticator app, or enter the key by hand:</p>
                <code className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{setup.secret}</code>
                <p>2. Type the 6-digit code the app shows to finish:</p>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="max-w-40 font-mono tracking-widest"
                />
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-negative">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Turn on"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {status?.enabled && mode === "idle" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Currently <span className="font-medium text-foreground">on</span>
              {status.enabledAt ? ` since ${new Date(status.enabledAt).toLocaleDateString()}` : ""}. Recovery codes left:{" "}
              <span className="font-medium text-foreground">{status.recoveryCodesRemaining}</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("recovery")}>
                New recovery codes
              </Button>
              <Button type="button" variant="outline" onClick={() => setMode("disable")}>
                Turn off
              </Button>
            </div>
          </div>
        )}

        {status?.enabled && mode !== "idle" && (
          <form onSubmit={mode === "disable" ? disable : regenerate} className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {mode === "disable" ? "Turning it off needs your password and a current code." : "The old recovery codes stop working. Confirm with your password and a current code."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tf-password2">Password</Label>
                <Input id="tf-password2" type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tf-code2">Authenticator or recovery code</Label>
                <Input id="tf-code2" autoComplete="one-time-code" required maxLength={16} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-negative">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} disabled={busy}>
                {busy ? "Working…" : mode === "disable" ? "Turn off two-factor" : "Generate new codes"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
