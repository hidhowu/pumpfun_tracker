"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DialogHead, Field, Notice } from "@/components/ui/dialog-parts";
import { listLiveWallets, transferSol } from "@/lib/live-wallet-api";
import { formatSol } from "@/lib/format";
import type { LiveWallet, LiveWalletListItem } from "@/lib/live-wallet-types";

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
  const valid = !!toId && (max || (/^\d{1,9}(\.\d{1,9})?$/.test(amount) && Number(amount) > 0)) && /^\d{6}$/.test(code);

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
          <Button variant="outline" className="gap-1.5">
            <ArrowUp /> Send
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHead
          icon={<ArrowUp className="size-5" />}
          title="Send SOL"
          help="Only wallets on this platform are listed, so nothing can leave the platform from here."
          description="Send SOL to another wallet on this platform."
        />
        <p className="-mt-1 text-[13px] leading-5 text-text-2">
          From <b className="font-semibold text-foreground">{wallet.name}</b> to another wallet on this platform.
          {solBalance != null ? ` Balance: ${formatSol(solBalance)}.` : ""}
        </p>
        {!twoFactorEnabled ? (
          <>
            <Notice tone="neg">Turn on two-factor authentication first: sending SOL is confirmed with a code from your authenticator app.</Notice>
            <DialogFooter>
              <Button asChild>
                <Link href="/account">Turn on two-factor</Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <Field label="Send to" htmlFor="send-to" note={target ? <span className="font-mono break-all">{target.address}</span> : undefined}>
                <Select value={toId || undefined} onValueChange={setToId}>
                  <SelectTrigger id="send-to" className="w-full max-md:h-11">
                    <SelectValue placeholder={others == null ? "Loading wallets…" : others.length === 0 ? "No other wallet on the platform" : "Choose a wallet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {others?.map((w) => (
                      <SelectItem key={w._id} value={w._id}>
                        {w.name} · {w.address.slice(0, 4)}…{w.address.slice(-4)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Amount (SOL)" htmlFor="send-amount" help="The network fee (0.000005 SOL) is paid on top. Max sends everything and leaves the wallet empty.">
                <div className="flex gap-2">
                  <Input
                    id="send-amount"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={max ? "Everything (Max)" : amount}
                    disabled={max}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    className="tabular-nums max-md:h-11"
                  />
                  <Button type="button" variant={max ? "default" : "outline"} className="max-md:h-11" onClick={() => setMax((v) => !v)} aria-pressed={max}>
                    Max
                  </Button>
                </div>
              </Field>
              <Field label="Authenticator code" htmlFor="send-code">
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
              </Field>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={sending}>
                Cancel
              </Button>
              <Button className="gap-1.5" onClick={handleSend} disabled={!valid || sending}>
                {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                {sending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
