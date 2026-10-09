"use client";

import { useState, useSyncExternalStore } from "react";
import { Activity, AlertTriangle, LogIn } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/** Only same-site paths - never an absolute or protocol-relative URL (open redirect). */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/login")) return "/";
  return raw;
}

const subscribeNever = () => () => {};
/** True when the page came over plain HTTP from somewhere other than this machine. */
function isInsecureOrigin() {
  const { protocol, hostname } = window.location;
  return protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const insecure = useSyncExternalStore(subscribeNever, isInsecureOrigin, () => false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Sign-in failed (${res.status})`);
        setPassword("");
        return;
      }
      // Full navigation (not router.push) so the signed-in shell loads fresh.
      window.location.assign(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Activity className="size-5" />
          </div>
          <CardTitle className="text-lg">pump.fun tracker</CardTitle>
          <CardDescription>Sign in to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {insecure && (
              <p className="flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                This connection isn&apos;t encrypted (HTTP). Your password can be read by anyone on the network - serve
                the dashboard over HTTPS.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                maxLength={64}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              <LogIn />
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
