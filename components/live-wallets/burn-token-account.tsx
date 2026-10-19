"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Flame, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatAmount, tokenLabel } from "./shared";
import { burnTokenAccount } from "@/lib/live-wallet-api";
import { formatSol } from "@/lib/format";
import type { LiveTokenAccount } from "@/lib/live-wallet-types";

/**
 * Burns a token account: destroys whatever tokens are in it, closes the account and returns its rent deposit to the
 * wallet - one transaction, signed on the server with the wallet's own key. Self-contained (it only needs the wallet id and
 * the account), so it can be dropped in anywhere a token account is shown. Always asks first; it can't be undone.
 *
 * `compact` renders an icon-only button for tight rows. `onDone` runs after the transaction is sent (refresh your data there).
 */
export function BurnTokenAccountButton({
  walletId,
  account,
  onDone,
  compact = false,
  className,
}: {
  walletId: string;
  account: LiveTokenAccount;
  onDone?: () => void;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const label = tokenLabel(account.symbol, account.mint);
  const hasTokens = account.balance > 0;
  const frozen = account.state === "frozen";
  const verb = hasTokens ? "Burn & close" : "Close account";

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await burnTokenAccount(walletId, account.account);
      setOpen(false);
      const reclaimed = formatSol(result.reclaimedLamports / 1e9);
      const done = hasTokens ? `Burned ${formatAmount(result.burned)} ${label} and closed the account` : "Token account closed";
      toast.success(result.status === "confirmed" ? done : `${done} - sent, waiting for the network to confirm`, {
        description: `${reclaimed} returned to the wallet`,
        action: { label: "View", onClick: () => window.open(`https://solscan.io/tx/${result.signature}`, "_blank", "noopener,noreferrer") },
      });
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The transaction failed");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon-sm" disabled={frozen} aria-label={`${verb}: ${label}`} title={frozen ? "Frozen by the token's issuer - it can't be closed" : verb} className={className}>
            <Flame className="size-4 text-negative" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={frozen} title={frozen ? "Frozen by the token's issuer - it can't be closed" : undefined} className={className}>
            <Flame className="size-3.5 text-negative" /> {verb}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader className="items-start text-left">
          <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-negative/15 text-negative">
            <Flame className="size-6" />
          </span>
          <AlertDialogTitle className="text-xl font-extrabold">{hasTokens ? `Burn ${label} and close the account?` : `Close this ${label} account?`}</AlertDialogTitle>
          <AlertDialogDescription className="leading-relaxed">
            {hasTokens ? (
              <>
                This permanently destroys <b className="text-foreground">{formatAmount(account.balance)} {account.symbol ?? "tokens"}</b> and closes the token account. The{" "}
                <b className="text-foreground">{formatSol(account.rentLamports / 1e9)}</b> deposit held in it is returned to the wallet, minus a tiny network fee.
              </>
            ) : (
              <>
                The account is empty. Closing it returns the <b className="text-foreground">{formatSol(account.rentLamports / 1e9)}</b> deposit held in it to the wallet, minus a tiny network fee.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {hasTokens ? (
          <div className="flex items-start gap-2.5 rounded-2xl border border-negative/30 bg-negative/10 px-4 py-3 text-[13px] leading-relaxed">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-negative" />
            <span>Burned tokens are gone for good. They can&apos;t be sent back or recovered, even by the token&apos;s creator.</span>
          </div>
        ) : null}
        <AlertDialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0 pt-2">
          <Button variant="outline" className="h-11 px-5" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button className="h-11 bg-negative px-6 text-negative-foreground hover:bg-negative/90" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />}
            {busy ? "Sending..." : verb}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
