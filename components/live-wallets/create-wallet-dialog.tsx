"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, Loader2, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { KeyDisplay } from "./key-display";
import { createLiveWallet } from "@/lib/live-wallet-api";
import { startKeyHandoff } from "@/lib/live-wallet-crypto";
import type { LiveWallet } from "@/lib/live-wallet-types";

type Revealed = { wallet: LiveWallet; secretKey: string };

/**
 * Create a wallet -> the server generates it and sends the private key encrypted for THIS browser only -> shown here.
 * Needs two-factor turned on (the server enforces it; the dialog just explains it). The dialog can't be dismissed by
 * clicking outside while the key is on screen, and the key is dropped from memory when it closes. Later, the key can be
 * viewed again from the wallet's page with a fresh 2FA code.
 */
export function CreateLiveWalletDialog({ onCreated, twoFactorEnabled }: { onCreated: () => void; twoFactorEnabled: boolean }) {
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
        <Button className="gap-1.5">
          <Plus className="size-4" /> New wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => revealed && e.preventDefault()}>
        {revealed ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" /> Save your private key
              </DialogTitle>
              <DialogDescription>
                &quot;{revealed.wallet.name}&quot; is ready. Copy the private key now. You can view it again later from the wallet&apos;s page with a two-factor code.
              </DialogDescription>
            </DialogHeader>
            <KeyDisplay address={revealed.wallet.address} secretKey={revealed.secretKey} />
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
              <DialogDescription>
                Wallets hold real funds, so only accounts with two-factor authentication turned on can create them or view their private keys.
              </DialogDescription>
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
              <DialogTitle>New live wallet</DialogTitle>
              <DialogDescription>Generates a brand-new Solana wallet. Its private key is delivered encrypted to this browser.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="live-wallet-name">Name</Label>
              <Input
                id="live-wallet-name"
                value={name}
                maxLength={100}
                placeholder="e.g. Main trading wallet"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
              The key is stored on the server only in encrypted form (AES-256-GCM). Viewing it again always needs a fresh 2FA code.
            </p>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={creating}>
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
