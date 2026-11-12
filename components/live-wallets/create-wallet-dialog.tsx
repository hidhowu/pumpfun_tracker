"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Loader2, Plus, ShieldOff, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogHead, Field } from "@/components/ui/dialog-parts";
import { Input } from "@/components/ui/input";
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
          <Button className="gap-1.5">
            <Plus className="size-4" strokeWidth={2.2} /> New wallet
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]" onInteractOutside={(e) => revealed && e.preventDefault()}>
        {revealed ? (
          <>
            <DialogHeader className="flex-row items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pos-soft text-positive">
                <Check className="size-5" />
              </span>
              <DialogTitle>Wallet ready</DialogTitle>
              <DialogDescription className="sr-only">Save the private key now.</DialogDescription>
            </DialogHeader>
            <p className="-mt-1 text-[13px] leading-5 text-text-2">
              &quot;{revealed.wallet.name}&quot; is created. Save the private key now. Viewing it later needs a two-factor code.
            </p>
            <KeyDisplay address={revealed.wallet.address} secretKey={revealed.secretKey} />
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : !twoFactorEnabled ? (
          <>
            <DialogHeader className="items-center gap-2 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-neg-soft text-destructive">
                <ShieldOff className="size-7" />
              </span>
              <DialogTitle className="pr-0 text-lg">Turn on two-factor first</DialogTitle>
              <DialogDescription>Wallets hold real funds. Only accounts with two-factor sign-in can create a wallet or view its private key.</DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-center">
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Not now
              </Button>
              <Button asChild>
                <Link href="/account">Turn on two-factor</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHead
              icon={<WalletCards className="size-5" />}
              title="Create a wallet"
              help="Stored encrypted (AES-256-GCM) on our server and sent to you encrypted for this browser."
              description="Creates a new Solana wallet. You get its private key once."
            />
            <p className="-mt-1 text-[13px] leading-5 text-text-2">Creates a new Solana wallet. You get its private key once to save, and can view it again later with a two-factor code.</p>
            <Field label="Wallet name" htmlFor="live-wallet-name">
              <Input
                id="live-wallet-name"
                autoFocus
                value={name}
                maxLength={100}
                placeholder="e.g. Main trading"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="max-md:h-11"
              />
            </Field>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating && <Loader2 className="animate-spin" />}
                Generate wallet
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
