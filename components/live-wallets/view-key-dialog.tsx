"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { KeyDisplay } from "./key-display";
import { revealLiveWalletKey } from "@/lib/live-wallet-api";
import { startKeyHandoff } from "@/lib/live-wallet-crypto";
import type { LiveWallet } from "@/lib/live-wallet-types";

const AUTO_HIDE_MS = 2 * 60 * 1000;
const PLAIN_FOOTER = "mx-0 mb-0 border-0 bg-transparent p-0 pt-2";

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
    return () => clearTimeout(timer);
  }, [secretKey]);

  async function handleVerify() {
    if (!/^\d{6}$/.test(code)) return toast.error("Enter the 6-digit code from your authenticator app");
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const handoff = await startKeyHandoff();
      const { key } = await revealLiveWalletKey(wallet._id, code, handoff.clientPublicKey);
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
          <Button className="gap-2">
            <KeyRound className="size-4" /> View private key
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md" onInteractOutside={(e) => secretKey && e.preventDefault()}>
        {secretKey ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-extrabold">Private key</DialogTitle>
              <DialogDescription>
                {wallet.name} · this hides itself when you close it, or after two minutes. This view was recorded in the Logs page.
              </DialogDescription>
            </DialogHeader>
            <KeyDisplay address={wallet.address} secretKey={secretKey} />
            <DialogFooter className={PLAIN_FOOTER}>
              <Button variant="outline" className="h-11 px-5" onClick={() => handleOpenChange(false)}>
                Hide and close
              </Button>
            </DialogFooter>
          </>
        ) : !twoFactorEnabled ? (
          <>
            <DialogHeader className="items-center text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-negative/15 text-negative">
                <ShieldAlert className="size-8" />
              </span>
              <DialogTitle className="mt-2 text-xl font-extrabold">Turn on two-factor first</DialogTitle>
              <DialogDescription>Private keys can only be viewed by accounts with two-factor authentication turned on.</DialogDescription>
            </DialogHeader>
            <DialogFooter className={`${PLAIN_FOOTER} sm:justify-center`}>
              <Button asChild className="h-11 px-6">
                <Link href="/account">Turn on two-factor</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <span className="mb-1 flex size-14 items-center justify-center rounded-full bg-primary/15 text-brand-soft">
                <ShieldCheck className="size-7" />
              </span>
              <DialogTitle className="text-2xl font-extrabold tracking-tight">Confirm it&apos;s you</DialogTitle>
              <DialogDescription className="leading-relaxed">Enter the 6-digit code from your authenticator app to view the private key of {wallet.name}.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="view-key-code" className="text-[13px] font-bold text-muted-foreground">
                Authenticator code
              </Label>
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
                className="h-14 border-primary/70 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">A code works only once. If you just signed in with it, wait for the next one.</p>
            </div>
            <DialogFooter className={PLAIN_FOOTER}>
              <Button variant="outline" className="h-11 px-5" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button className="h-11 px-6" onClick={handleVerify} disabled={checking || code.length !== 6}>
                {checking && <Loader2 className="size-4 animate-spin" />}
                View key
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
