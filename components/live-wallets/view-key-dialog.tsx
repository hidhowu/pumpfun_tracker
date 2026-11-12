"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DialogHead, Field } from "@/components/ui/dialog-parts";
import { KeyDisplay } from "./key-display";
import { revealLiveWalletKey } from "@/lib/live-wallet-api";
import { startKeyHandoff } from "@/lib/live-wallet-crypto";
import type { LiveWallet } from "@/lib/live-wallet-types";

const AUTO_HIDE_MS = 2 * 60 * 1000;

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * "View private key": asks for a fresh authenticator code, then shows the key (delivered encrypted for this browser).
 * The key disappears when the dialog closes, or after two minutes on screen. Accounts without two-factor are told to turn
 * it on first - the server refuses them either way.
 */
export function ViewKeyDialog({ wallet, twoFactorEnabled, trigger }: { wallet: LiveWallet; twoFactorEnabled: boolean; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [leftMs, setLeftMs] = useState(AUTO_HIDE_MS);
  const busy = useRef(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCode("");
      setSecretKey(null);
    }
  }

  useEffect(() => {
    if (!secretKey) return;
    const timer = setTimeout(() => {
      setSecretKey(null);
      setOpen(false);
      setCode("");
      toast.message("Private key hidden again");
    }, AUTO_HIDE_MS);
    // Only for showing how long is left; the timeout above is what hides the key.
    const shownAt = Date.now();
    const tick = setInterval(() => setLeftMs(Math.max(0, AUTO_HIDE_MS - (Date.now() - shownAt))), 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [secretKey]);

  async function handleVerify() {
    if (!/^\d{6}$/.test(code)) return toast.error("Enter the 6-digit code from your authenticator app");
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const handoff = await startKeyHandoff();
      const { key } = await revealLiveWalletKey(wallet._id, code, handoff.clientPublicKey);
      setLeftMs(AUTO_HIDE_MS);
      setSecretKey(await handoff.decrypt(key, wallet.address));
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't verify the code");
      setCode("");
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-1.5">
            <KeyRound /> View private key
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]" onInteractOutside={(e) => secretKey && e.preventDefault()}>
        {secretKey ? (
          <>
            <DialogHead
              icon={<KeyRound className="size-5" />}
              title="Private key"
              help="Hides itself when you close it or after two minutes. This view was recorded in the Logs page."
              description={`Private key of ${wallet.name}.`}
            />
            <KeyDisplay address={wallet.address} secretKey={secretKey} />
            <p className="-mt-1 text-xs text-text-3 tabular-nums">Hides again in {clock(leftMs)}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Hide and close
              </Button>
            </DialogFooter>
          </>
        ) : !twoFactorEnabled ? (
          <>
            <DialogHeader className="items-center gap-2 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-neg-soft text-destructive">
                <ShieldOff className="size-7" />
              </span>
              <DialogTitle className="pr-0 text-lg">Turn on two-factor first</DialogTitle>
              <DialogDescription>Private keys can only be viewed by accounts with two-factor authentication turned on.</DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-center">
              <Button asChild>
                <Link href="/account">Turn on two-factor</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHead
              icon={<ShieldCheck className="size-5" />}
              title="Confirm it's you"
              help="A code works only once. If you just signed in with it, wait for the next one."
              description={`Enter a code to view the private key of ${wallet.name}.`}
            />
            <p className="-mt-1 text-[13px] leading-5 text-text-2">Enter the 6-digit code from your authenticator app to view the private key of {wallet.name}.</p>
            <Field label="Authenticator code" htmlFor="view-key-code">
              <Input
                id="view-key-code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                className="h-14 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
              />
            </Field>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleVerify} disabled={checking || code.length !== 6}>
                {checking && <Loader2 className="animate-spin" />}
                View key
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
