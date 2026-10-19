"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ActivityTable } from "./activity-table";
import { formatPrice, StatBox, TokenAvatar } from "./shared";
import { formatSol, formatUsd } from "@/lib/format";
import type { LiveChain } from "@/lib/live-wallet-types";

/**
 * SOL itself: the balance and what it is worth, the refundable deposits locked in token accounts, and every movement of
 * SOL in this wallet - swaps against tokens, plain transfers and network fees. The same panel will hold send/receive later.
 */
export function SolSheet({ walletId, open, chain, onClose }: { walletId: string; open: boolean; chain: LiveChain | null | undefined; onClose: () => void }) {
  const rentLamports = chain?.accounts.reduce((sum, a) => sum + a.rentLamports, 0) ?? 0;
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]">
        <SheetHeader className="flex-row items-center gap-3.5 px-5 pt-5 pr-14 pb-3">
          <TokenAvatar symbol="SOL" className="size-12" />
          <div className="min-w-0">
            <SheetTitle className="text-xl font-extrabold">Solana</SheetTitle>
            <SheetDescription>SOL · the network&apos;s own coin</SheetDescription>
          </div>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-5 pb-8">
          <div>
            <div className="text-4xl font-extrabold tracking-tight tabular-nums">{chain ? formatUsd(chain.solValueUsd) : "-"}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">{chain ? `${formatSol(chain.solBalance)} · ${formatPrice(chain.solUsd)} each` : "waiting for the chain"}</div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <StatBox label="Balance" value={chain ? formatSol(chain.solBalance) : "-"} />
            <StatBox label="Price" value={chain ? formatPrice(chain.solUsd) : "-"} />
            <StatBox label="Held in token accounts" value={formatSol(rentLamports / 1e9)} hint={`${chain?.accounts.length ?? 0} account${chain?.accounts.length === 1 ? "" : "s"} · refundable rent`} />
            <StatBox label="Tokens value" value={chain ? formatUsd(chain.tokensValueUsd) : "-"} hint={chain ? `${chain.tokens.length} held` : undefined} />
          </div>
          <div>
            <h3 className="mb-3 text-[15px] font-extrabold">SOL history</h3>
            {open ? <ActivityTable walletId={walletId} mint="SOL" layout="list" showSummary={false} /> : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
