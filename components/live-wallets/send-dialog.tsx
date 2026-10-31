"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { listLiveWallets, transferSol } from "@/lib/live-wallet-api";
import { formatSol } from "@/lib/format";
import type { LiveWallet, LiveWalletListItem } from "@/lib/live-wallet-types";

const PLAIN_FOOTER = "mx-0 mb-0 border-0 bg-transparent p-0 pt-2";

/**
 * "Send": moves SOL from this wallet to another wallet on the platform (the receiving wallet is picked from the list - there is no free address
 * field, so nothing can leave the platform from here). A fresh authenticator code confirms it.
 */
export function SendDialog({ wallet, twoFactorEnabled, solBalance, onSent, trigger }: { wallet: LiveWallet; twoFactorEnabled: boolean; solBalance: number | null; onSent?: () => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState<LiveWalletListItem[] | null>(null);
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [max, setMax] = useState(false);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (sending) return;
    setOpen(next);
    if (next) {
      listLiveWallets()
        .then(({ wallets }) => setOthers(wallets.filter((w) => w._id !== wallet._id)))
        .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't load the wallets"));
    } else {
      setToId("");
      setAmount("");
      setMax(false);
      setCode("");
    }
  }

  const target = others?.find((w) => w._id === toId);
  const valid = !!toId && (max || /^\d{1,9}(\.\d{1,9})?$/.test(amount) && Number(amount) > 0) && /^\d{6}$/.test(code);

  async function handleSend() {
    if (!valid || sending) return;
    setSending(true);
    try {
      const r = await transferSol(wallet._id, { toWalletId: toId, ...(max ? { all: true } : { amountSol: amount }), code });
      toast.success(`Sent ${formatSol(r.lamports / 1e9)} to ${r.toName}${r.status === "pending" ? " (not yet confirmed - check the activity in a moment)" : ""}`);
      setOpen(false);
      setToId("");
      setAmount("");
      setMax(false);
      setCode("");
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't send the SOL");
      setCode("");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className="gap-2">
            <ArrowUp className="size-4" /> Send
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold">Send SOL</DialogTitle>
          <DialogDescription>
            From <b className="text-foreground">{wallet.name}</b> to another wallet on this platform.
            {solBalance != null ? ` Balance: ${formatSol(solBalance)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        {!twoFactorEnabled ? (
          <>
            <p className="text-sm text-muted-foreground">Turn on two-factor authentication first: sending SOL is confirmed with a code from your authenticator app.</p>
            <DialogFooter className={PLAIN_FOOTER}>
              <Button asChild className="h-11 px-6">
                <Link href="/account">Turn on two-factor</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="send-to" className="text-[13px] font-bold text-muted-foreground">
                  Send to
                </Label>
                <select
                  id="send-to"
                  value={toId}
                  onChange={(e) => setToId(e.target.value)}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">{others == null ? "Loading wallets…" : others.length === 0 ? "No other wallet on the platform" : "Choose a wallet"}</option>
                  {others?.map((w) => (
                    <option key={w._id} value={w._id}>
                      {w.name} · {w.address.slice(0, 4)}…{w.address.slice(-4)}
                    </option>
                  ))}
                </select>
                {target ? <p className="font-mono text-xs break-all text-muted-foreground">{target.address}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="send-amount" className="text-[13px] font-bold text-muted-foreground">
                  Amount (SOL)
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="send-amount"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={max ? "Everything (Max)" : amount}
                    disabled={max}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    className="h-11 tabular-nums"
                  />
                  <Button type="button" variant={max ? "default" : "outline"} className="h-11 px-4" onClick={() => setMax((v) => !v)}>
                    Max
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">The network fee (0.000005 SOL) is paid on top. Max sends everything and leaves the wallet empty.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="send-code" className="text-[13px] font-bold text-muted-foreground">
                  Authenticator code
                </Label>
                <Input
                  id="send-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  className="h-12 text-center font-mono text-xl tracking-[0.5em] placeholder:tracking-[0.5em]"
                />
              </div>
            </div>
            <DialogFooter className={PLAIN_FOOTER}>
              <Button variant="outline" className="h-11 px-5" onClick={() => handleOpenChange(false)} disabled={sending}>
                Cancel
              </Button>
              <Button className="h-11 gap-2 px-6" onClick={handleSend} disabled={!valid || sending}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                {sending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
