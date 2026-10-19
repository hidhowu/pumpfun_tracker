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

/**
 * "View private key": asks for a fresh authenticator code, then shows the key (delivered encrypted for this browser).
 * The key disappears when the dialog closes, or after two minutes on screen. Accounts without two-factor are told to turn
 * it on first - the server refuses them either way.
 */
export function ViewKeyDialog({ wallet, twoFactorEnabled }: { wallet: LiveWallet; twoFactorEnabled: boolean }) {
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
        <Button variant="outline" size="sm" className="gap-1.5">
          <KeyRound className="size-3.5" /> View private key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => secretKey && e.preventDefault()}>
        {secretKey ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" /> Private key
              </DialogTitle>
              <DialogDescription>&quot;{wallet.name}&quot; - this hides itself when you close it, or after two minutes.</DialogDescription>
            </DialogHeader>
            <KeyDisplay address={wallet.address} secretKey={secretKey} />
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : !twoFactorEnabled ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-negative" /> Two-factor sign-in required
              </DialogTitle>
              <DialogDescription>Private keys can only be viewed by accounts with two-factor authentication turned on.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button asChild>
                <Link href="/account">Turn on two-factor</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" /> Confirm it&apos;s you
              </DialogTitle>
              <DialogDescription>Enter the 6-digit code from your authenticator app to view the private key of &quot;{wallet.name}&quot;.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="view-key-code">Authenticator code</Label>
              <Input
                id="view-key-code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                className="font-mono tracking-widest"
              />
              <p className="text-xs text-muted-foreground">If you just signed in with this code, wait for the next one - a code works only once.</p>
            </div>
            <DialogFooter>
              <Button onClick={handleVerify} disabled={checking || code.length !== 6}>
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
