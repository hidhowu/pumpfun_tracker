"use client";

import { useState } from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import { copyText } from "@/lib/clipboard";
import { toast } from "sonner";

/** A wallet's address and private key (hidden until revealed), with the warning that goes with it. */
export function KeyDisplay({ address, secretKey }: { address: string; secretKey: string }) {
  const [show, setShow] = useState(false);

  async function copyKey() {
    if (await copyText(secretKey)) toast.success("Private key copied");
    else toast.error("Couldn't copy the key - reveal it and select it manually");
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="rounded-2xl border border-border bg-muted/50 px-4 py-3">
        <div className="text-xs font-semibold text-muted-foreground">Address</div>
        <div className="mt-1 flex items-start gap-2">
          <span className="min-w-0 flex-1 font-mono text-[13px] leading-relaxed break-all">{address}</span>
          <CopyButton value={address} label="wallet address" />
        </div>
      </div>

      <div className="rounded-2xl border border-negative/40 bg-negative/[0.07] px-4 py-3">
        <div className="text-xs font-semibold text-[#ff8a96]">Private key</div>
        <div className="mt-2 min-h-[4.5rem] font-mono text-[13px] leading-relaxed break-all">{show ? secretKey : "•".repeat(44)}</div>
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="secondary" className="h-10 flex-1" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide private key" : "Show private key"}>
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />} {show ? "Hide" : "Show"}
          </Button>
          <Button type="button" className="h-10 flex-1" onClick={copyKey}>
            Copy key
          </Button>
        </div>
        <p className="mt-2.5 text-xs text-muted-foreground">Base58 format. Works with Import private key in Phantom and Solflare.</p>
      </div>

      <div className="flex gap-2.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-chart-5" />
        <span>Anyone with this key controls the wallet&apos;s funds. Keep it in a password manager, never in a chat or screenshot.</span>
      </div>
    </div>
  );
}
