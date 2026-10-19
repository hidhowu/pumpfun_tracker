"use client";

import { useState } from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/copy-button";

/** A wallet's address and private key (hidden until the eye is clicked), with the warning that goes with it. */
export function KeyDisplay({ address, secretKey }: { address: string; secretKey: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label>Wallet address</Label>
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <span className="min-w-0 flex-1 break-all font-mono text-xs">{address}</span>
          <CopyButton value={address} label="wallet address" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Private key</Label>
        <div className="flex items-start gap-1 rounded-lg border border-negative/40 bg-negative/5 px-3 py-2">
          <span className="min-w-0 flex-1 break-all font-mono text-xs">{show ? secretKey : "•".repeat(48)}</span>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Hide private key" : "Show private key"}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {show ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          </button>
          <CopyButton value={secretKey} label="private key" />
        </div>
        <p className="text-xs text-muted-foreground">Base58 format - works with &quot;Import private key&quot; in Phantom and Solflare.</p>
      </div>

      <div className="flex gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-negative" />
        <span>Anyone with this key controls the wallet&apos;s funds. Store it in a password manager, never in a chat or screenshot.</span>
      </div>
    </div>
  );
}
