"use client";

import { Coins, Landmark, LineChart, Scale } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatTile } from "@/components/traders/stat-tile";
import { ActivityTable } from "./activity-table";
import { AddressChip, formatAmount, signedPercent, signedUsd, toneOf, TokenAvatar } from "./shared";
import { formatUsd } from "@/lib/format";
import type { LiveHolding } from "@/lib/live-wallet-types";

/** One token in the wallet: what is held, what it is worth, and every buy and sell of it with the profit or loss made. */
export function TokenSheet({ walletId, mint, holding, onClose }: { walletId: string; mint: string | null; holding: LiveHolding | null; onClose: () => void }) {
  return (
    <Sheet open={mint !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-3xl">
        {mint ? (
          <>
            <SheetHeader className="border-b border-border/60">
              <div className="flex items-center gap-3">
                <TokenAvatar icon={holding?.icon} symbol={holding?.symbol} className="size-10" />
                <div className="min-w-0">
                  <SheetTitle>{holding?.symbol ?? "Token"}</SheetTitle>
                  <SheetDescription className="flex items-center gap-2">
                    {holding?.name ? <span className="truncate">{holding.name}</span> : null}
                    <AddressChip value={mint} kind="token" label="mint address" chars={5} />
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>
            <div className="flex flex-col gap-4 p-4">
              {holding ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatTile label="Balance" value={formatAmount(holding.balance)} icon={Coins} hint={`${holding.accounts} token account${holding.accounts === 1 ? "" : "s"}`} />
                  <StatTile label="Value" value={holding.valueUsd === null ? "no price" : formatUsd(holding.valueUsd)} icon={Landmark} />
                  <StatTile
                    label="Unrealized P&L"
                    value={signedUsd(holding.unrealizedPnlUsd)}
                    icon={LineChart}
                    tone={toneOf(holding.unrealizedPnlUsd)}
                    hint={holding.unrealizedPnlPct === null ? "no cost basis" : `${signedPercent(holding.unrealizedPnlPct)} on ${formatUsd(holding.costBasisUsd)} cost`}
                  />
                  <StatTile label="Realized P&L" value={signedUsd(holding.realizedPnlUsd)} icon={Scale} tone={toneOf(holding.realizedPnlUsd)} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">This wallet no longer holds this token.</p>
              )}
              <ActivityTable walletId={walletId} mint={mint} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
