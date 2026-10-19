"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Loader2, Plus, ShieldAlert, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { KeyDisplay } from "./key-display";
import { createLiveWallet } from "@/lib/live-wallet-api";
import { startKeyHandoff } from "@/lib/live-wallet-crypto";
import type { LiveWallet } from "@/lib/live-wallet-types";

type Revealed = { wallet: LiveWallet; secretKey: string };

// The dialog footer is a grey bar by default; these dialogs use a plain row of buttons.
const PLAIN_FOOTER = "mx-0 mb-0 border-0 bg-transparent p-0 pt-2";

/**
 * Create a wallet -> the server generates it and sends the private key encrypted for THIS browser only -> shown here.
 * Needs two-factor turned on (the server enforces it; the dialog just explains it). The dialog can't be dismissed by
 * clicking outside while the key is on screen, and the key is dropped from memory when it closes. Later, the key can be
 * viewed again from the wallet's page with a fresh 2FA code.
 */
export function CreateLiveWalletDialog({ onCreated, twoFactorEnabled, trigger }: { onCreated: () => void; twoFactorEnabled: boolean; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const busy = useRef(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setName("");
      setRevealed(null);
    }
  }

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return toast.error("Enter a wallet name");
    if (busy.current) return;
    busy.current = true;
    setCreating(true);
    try {
      const handoff = await startKeyHandoff();
      const { wallet, key } = await createLiveWallet(trimmed, handoff.clientPublicKey);
      const secretKey = await handoff.decrypt(key, wallet.address);
      setRevealed({ wallet, secretKey });
      onCreated(); // the wallet exists now, whatever happens to this dialog
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      busy.current = false;
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="h-10 gap-2 px-5">
            <Plus className="size-4" /> New wallet
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => revealed && e.preventDefault()}>
        {revealed ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3 text-xl font-extrabold">
                <span className="flex size-9 items-center justify-center rounded-full bg-positive/15 text-positive">
                  <Check className="size-5" />
                </span>
                Wallet ready
              </DialogTitle>
              <DialogDescription>
                &quot;{revealed.wallet.name}&quot; is created. Save the private key now. You can view it again later, but only with a two-factor code.
              </DialogDescription>
            </DialogHeader>
            <KeyDisplay address={revealed.wallet.address} secretKey={revealed.secretKey} />
            <DialogFooter className={PLAIN_FOOTER}>
              <Button className="h-11 px-6" onClick={() => handleOpenChange(false)}>
                Done
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
              <DialogDescription>Wallets hold real funds. Only accounts with two-factor sign-in can create a wallet or view its private key.</DialogDescription>
            </DialogHeader>
            <DialogFooter className={`${PLAIN_FOOTER} sm:justify-center`}>
              <Button variant="outline" className="h-11 px-5" onClick={() => handleOpenChange(false)}>
                Not now
              </Button>
              <Button asChild className="h-11 px-6">
                <Link href="/account">Turn on two-factor</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <span className="mb-1 flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-[#8b7cff] to-[#35d6b0] text-white">
                <WalletCards className="size-7" />
              </span>
              <DialogTitle className="text-2xl font-extrabold tracking-tight">Create a wallet</DialogTitle>
              <DialogDescription className="leading-relaxed">
                We generate a brand-new Solana wallet. You get its private key once to save, and can view it again later with a 2FA code.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="live-wallet-name" className="text-[13px] font-bold text-muted-foreground">
                Wallet name
              </Label>
              <Input
                id="live-wallet-name"
                value={name}
                maxLength={100}
                placeholder="e.g. Main trading"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="h-12 text-base font-semibold"
              />
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-[18px] shrink-0 text-positive" />
              The key is stored on our server only in encrypted form (AES-256-GCM) and is sent to you encrypted for this browser.
            </div>
            <DialogFooter className={PLAIN_FOOTER}>
              <Button variant="outline" className="h-11 px-5" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button className="h-11 px-6" onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                Generate wallet
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
