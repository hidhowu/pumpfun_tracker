"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/dialog-parts";
import { HelpTip } from "@/components/ui/help-tip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** How many of lowercase / uppercase / digits / symbols a password mixes - the server wants 3 of the 4. */
function kindsOf(password: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
}

/** One of the live strength hints under the new-password fields: green when met, red when the user has typed and it isn't. */
function Hint({ ok, bad, children }: { ok: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap",
        ok ? "border-positive/30 bg-pos-soft text-positive" : bad ? "border-destructive/30 bg-neg-soft text-destructive" : "border-line-2 bg-surface-3 text-text-2"
      )}
    >
      {ok ? <Check className="size-3" strokeWidth={3} /> : null}
      {children}
    </span>
  );
}

export function ChangePasswordForm({ username }: { username: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("The new passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Failed to change password (${res.status})`);
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed - every other signed-in browser has been signed out");
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const typedNew = newPassword.length > 0;
  const typedConfirm = confirmPassword.length > 0;
  const lengthOk = newPassword.length >= 12;
  const kindsOk = kindsOf(newPassword) >= 3;
  const matches = typedConfirm && newPassword === confirmPassword;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-[20px] border border-border bg-card p-4 md:p-6">
      <h2 className="flex items-center gap-2 text-[17px] leading-6 font-semibold">
        <KeyRound className="size-[18px] text-primary" />
        <span>
          Change password
          <HelpTip>At least 12 characters, mixing 3 of: lowercase, uppercase, digits, symbols. Changing it signs out every other browser signed in as this account.</HelpTip>
        </span>
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Lets password managers associate the new password with this account. */}
        <input type="hidden" name="username" autoComplete="username" value={username} />
        <Field label="Current password" htmlFor="current-password">
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="max-md:h-11"
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="New password" htmlFor="new-password">
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="max-md:h-11"
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="max-md:h-11"
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Password checks">
          <Hint ok={lengthOk} bad={typedNew && !lengthOk}>
            12+ characters
          </Hint>
          <Hint ok={kindsOk} bad={typedNew && !kindsOk}>
            3 of 4 kinds
          </Hint>
          <Hint ok={matches} bad={typedConfirm && !matches}>
            match
          </Hint>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={saving} className="max-md:h-11 max-md:w-full">
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Change password"}
          </Button>
        </div>
      </form>
    </section>
  );
}
