"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ActivityTable } from "./activity-table";
import { AddressChip, formatAmount, formatPrice, signedPercent, signedUsd, toneClass, TokenAvatar } from "./shared";
import { formatUsd } from "@/lib/format";
import type { LiveHolding } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

function Stat({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card p-3.5">
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className={cn("mt-1 truncate text-[17px] font-extrabold tabular-nums", className)}>{value}</div>
      {hint ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** One token in the wallet: what is held, what it is worth, and every buy, sell and transfer of it with the profit or loss made. */
export function TokenSheet({ walletId, mint, holding, onClose }: { walletId: string; mint: string | null; holding: LiveHolding | null; onClose: () => void }) {
  return (
    <Sheet open={mint !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]">
        {mint ? (
          <>
            <SheetHeader className="flex-row items-center gap-3.5 px-5 pt-5 pr-14 pb-3">
              <TokenAvatar icon={holding?.icon} symbol={holding?.symbol} className="size-12" />
              <div className="min-w-0">
                <SheetTitle className="truncate text-xl font-extrabold">{holding?.symbol ?? "Token"}</SheetTitle>
                <SheetDescription className="flex min-w-0 items-center gap-2">
                  {holding?.name ? <span className="max-w-40 truncate">{holding.name}</span> : null}
                  <AddressChip value={mint} kind="token" label="mint address" chars={4} />
                </SheetDescription>
              </div>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-5 pb-8">
              {holding ? (
                <>
                  <div>
                    <div className="text-4xl font-extrabold tracking-tight tabular-nums">{holding.valueUsd === null ? "No price" : formatUsd(holding.valueUsd)}</div>
                    <div className="mt-0.5 text-[13px] text-muted-foreground tabular-nums">
                      {formatAmount(holding.balance)} {holding.symbol ?? ""} · {formatPrice(holding.priceUsd)} each
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Stat
                      label="Average cost"
                      value={holding.costBasisUsd !== null && holding.balance > 0 ? formatPrice(holding.costBasisUsd / holding.balance) : "None"}
                      hint={holding.costBasisUsd === null ? "tokens were received, not bought" : "per token"}
                    />
                    <Stat
                      label="Unrealized"
                      value={holding.unrealizedPnlUsd === null ? "No cost basis" : signedUsd(holding.unrealizedPnlUsd)}
                      hint={holding.unrealizedPnlPct === null ? undefined : signedPercent(holding.unrealizedPnlPct)}
                      className={toneClass(holding.unrealizedPnlUsd)}
                    />
                    <Stat label="Realized" value={signedUsd(holding.realizedPnlUsd)} className={toneClass(holding.realizedPnlUsd)} />
                    <Stat label="Token accounts" value={String(holding.accounts)} />
                  </div>
                </>
              ) : (
                <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">This wallet no longer holds this token.</p>
              )}
              <div>
                <h3 className="mb-3 text-[15px] font-extrabold">{holding?.symbol ?? "Token"} history</h3>
                <ActivityTable walletId={walletId} mint={mint} layout="list" showSummary={false} />
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
