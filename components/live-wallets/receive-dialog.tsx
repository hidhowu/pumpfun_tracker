"use client";

import { useMemo, useState } from "react";
import { ArrowDown, Copy, TriangleAlert } from "lucide-react";
import qrcode from "qrcode-generator";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { DialogHead } from "@/components/ui/dialog-parts";
import { CopyButton } from "@/components/copy-button";
import { copyText } from "@/lib/clipboard";

/** The wallet's address as text and as a QR code, for receiving SOL or any Solana token. */
export function ReceiveDialog({ name, address, trigger }: { name: string; address: string; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // The QR is generated here from the (base58) address, so the SVG string is ours - nothing from outside goes into it.
  const qrSvg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(address);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
  }, [address]);

  async function copyAddress() {
    if (await copyText(address)) toast.success("Address copied");
    else toast.error("Couldn't copy the address - select it and press Ctrl+C");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className="gap-1.5">
            <ArrowDown /> Receive
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHead
          icon={<ArrowDown className="size-5" />}
          title="Receive"
          help={`Scan or copy the address to receive SOL and any Solana token into "${name}".`}
          description={`Receive SOL or tokens into ${name}.`}
        />
        <div className="flex flex-col items-center gap-4">
          <div role="img" aria-label="QR code of the wallet address" className="w-full max-w-56 rounded-3xl bg-white p-4 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3">
            <div className="text-xs text-text-3">Your Solana address</div>
            <div className="mt-1.5 flex items-start gap-2">
              <span className="min-w-0 flex-1 font-mono text-[13px] leading-5 break-all">{address}</span>
              <CopyButton value={address} label="wallet address" />
            </div>
          </div>
          <Button className="w-full gap-1.5 max-md:h-11" onClick={copyAddress}>
            <Copy /> Copy address
          </Button>
          <div className="flex w-full items-start gap-2.5 text-[13px] leading-5 text-text-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            Only send assets on the Solana network. Anything sent from another network will be lost.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
