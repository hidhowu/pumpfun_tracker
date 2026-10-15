"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * A small "copy" button to put beside an address, token or signature that the page only shows shortened. One click copies the FULL value - no need
 * to open the item first. It never triggers the row it sits in (rows are often clickable links), and shows a tick for a moment as feedback.
 */
export function CopyButton({ value, label = "address", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!value) return;
    if (await copyText(value)) {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } else {
      toast.error(`Couldn't copy the ${label} - select it and press Ctrl+C`);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", copied && "text-positive", className)}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}
