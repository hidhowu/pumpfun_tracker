"use client";

import { useMemo, useState } from "react";
import { ArrowDown, TriangleAlert } from "lucide-react";
import qrcode from "qrcode-generator";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { CopyButton } from "@/components/copy-button";
import { copyText } from "@/lib/clipboard";
import { toast } from "sonner";

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
          <Button variant="outline" className="gap-2">
            <ArrowDown className="size-4" /> Receive
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold">Receive</DialogTitle>
          <DialogDescription>
            Scan or copy the address to receive SOL and any Solana token into <b className="text-foreground">{name}</b>.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-5">
          <div role="img" aria-label="QR code of the wallet address" className="w-full max-w-60 rounded-3xl bg-white p-4 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <div className="w-full rounded-2xl border border-border bg-muted/50 p-4">
            <div className="text-xs font-semibold text-muted-foreground">Your Solana address</div>
            <div className="mt-1.5 flex items-start gap-2">
              <span className="min-w-0 flex-1 font-mono text-sm leading-relaxed break-all">{address}</span>
              <CopyButton value={address} label="wallet address" />
            </div>
          </div>
          <Button className="h-11 w-full text-base" onClick={copyAddress}>
            Copy address
          </Button>
          <div className="flex w-full items-start gap-2.5 text-[13px] leading-relaxed text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-chart-5" />
            Only send assets on the Solana network. Anything sent from another network will be lost.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
