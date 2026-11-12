"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { copyText } from "@/lib/clipboard";

/** A wallet's address and private key (hidden until revealed), with the warning that goes with it. */
export function KeyDisplay({ address, secretKey }: { address: string; secretKey: string }) {
  const [show, setShow] = useState(false);

  async function copyKey() {
    if (await copyText(secretKey)) toast.success("Private key copied");
    else toast.error("Couldn't copy the key - reveal it and select it manually");
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
        <div className="text-xs text-text-3">Address</div>
        <div className="mt-1 flex items-start gap-2">
          <span className="min-w-0 flex-1 font-mono text-[13px] leading-5 break-all">{address}</span>
          <CopyButton value={address} label="wallet address" />
        </div>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-neg-soft px-4 py-3">
        <div className="text-xs font-medium text-destructive">Private key</div>
        <div className="mt-2 min-h-[4.5rem] font-mono text-[13px] leading-5 break-all">{show ? secretKey : "•".repeat(44)}</div>
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="outline" className="flex-1 max-md:h-11" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide private key" : "Show private key"}>
            {show ? <EyeOff /> : <Eye />} {show ? "Hide" : "Show"}
          </Button>
          <Button type="button" className="flex-1 max-md:h-11" onClick={copyKey}>
            <Copy /> Copy key
          </Button>
        </div>
        <p className="mt-2.5 text-xs text-text-2">Base58 format. Works with Import private key in Phantom and Solflare.</p>
      </div>

      <div className="flex gap-2.5 px-1 text-[13px] leading-5 text-text-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
        <span>Anyone with this key controls the wallet&apos;s funds. Keep it in a password manager, never in a chat or screenshot.</span>
      </div>
    </div>
  );
}
