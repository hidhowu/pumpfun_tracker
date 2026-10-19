"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddressChip, formatAmount, formatPrice, signedPercent, signedUsd, toneClass, TokenAvatar } from "./shared";
import { formatSol, formatUsd } from "@/lib/format";
import type { LiveChain, LiveHolding, LiveTokenAccount } from "@/lib/live-wallet-types";

/** SOL first, then every token the wallet holds, biggest value first. Clicking a token opens its history and profit/loss. */
export function HoldingsTable({ chain, onSelect }: { chain: LiveChain; onSelect: (mint: string) => void }) {
  return (
    <Card className="overflow-hidden border-border/60">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="border-border/60 hover:bg-transparent">
              <TableHead className="pl-4">Asset</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Unrealized P&amp;L</TableHead>
              <TableHead className="pr-4 text-right">Realized P&amp;L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="border-border/60">
              <TableCell className="pl-4">
                <div className="flex items-center gap-3">
                  <TokenAvatar symbol="SOL" />
                  <div className="flex flex-col leading-tight">
                    <span className="font-medium">SOL</span>
                    <span className="text-xs text-muted-foreground">Solana</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatSol(chain.solBalance)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{formatPrice(chain.solUsd)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatUsd(chain.solValueUsd)}</TableCell>
              <TableCell className="text-right text-muted-foreground">-</TableCell>
              <TableCell className="pr-4 text-right text-muted-foreground">-</TableCell>
            </TableRow>
            {chain.tokens.map((t: LiveHolding) => (
              <TableRow key={t.mint} className="cursor-pointer border-border/60" onClick={() => onSelect(t.mint)}>
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <TokenAvatar icon={t.icon} symbol={t.symbol} />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="max-w-40 truncate font-medium">{t.symbol ?? "Unknown token"}</span>
                      <span className="max-w-40 truncate text-xs text-muted-foreground">{t.name ?? t.mint.slice(0, 8)}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatAmount(t.balance)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{formatPrice(t.priceUsd)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{t.valueUsd === null ? <span className="text-muted-foreground">no price</span> : formatUsd(t.valueUsd)}</TableCell>
                <TableCell className={`text-right tabular-nums ${toneClass(t.unrealizedPnlUsd)}`}>
                  {t.unrealizedPnlUsd === null ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <span className="inline-flex flex-col items-end">
                      <span>{signedUsd(t.unrealizedPnlUsd)}</span>
                      <span className="text-[11px] opacity-80">{signedPercent(t.unrealizedPnlPct)}</span>
                    </span>
                  )}
                </TableCell>
                <TableCell className={`pr-4 text-right tabular-nums ${toneClass(t.realizedPnlUsd)}`}>{t.realizedPnlUsd ? signedUsd(t.realizedPnlUsd) : <span className="text-muted-foreground">-</span>}</TableCell>
              </TableRow>
            ))}
            {chain.tokens.length === 0 ? (
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No tokens yet - only SOL. Send some to the wallet&apos;s address to get started.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Every token account the wallet owns - including empty ones, which still hold a small refundable rent deposit. */
export function TokenAccountsTable({ accounts, onSelect }: { accounts: LiveTokenAccount[]; onSelect: (mint: string) => void }) {
  return (
    <Card className="overflow-hidden border-border/60">
      <CardContent className="p-0">
        {accounts.length === 0 ? (
          <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">This wallet has no token accounts.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border/60 hover:bg-transparent">
                <TableHead className="pl-4">Token</TableHead>
                <TableHead>Token account</TableHead>
                <TableHead>Mint</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Program</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="pr-4 text-right">Rent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.account} className="border-border/60">
                  <TableCell className="pl-4">
                    <button type="button" onClick={() => onSelect(a.mint)} className="flex items-center gap-2 text-left hover:text-primary">
                      <TokenAvatar icon={a.icon} symbol={a.symbol} className="size-6" />
                      <span className="max-w-32 truncate font-medium">{a.symbol ?? "Unknown"}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <AddressChip value={a.account} label="token account address" chars={5} />
                  </TableCell>
                  <TableCell>
                    <AddressChip value={a.mint} kind="token" label="mint address" chars={5} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatAmount(a.balance)}</TableCell>
                  <TableCell className="text-muted-foreground">{a.program === "token-2022" ? "Token-2022" : "SPL Token"}</TableCell>
                  <TableCell className={a.state === "frozen" ? "text-negative" : "text-muted-foreground"}>{a.state}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">{formatSol(a.rentLamports / 1e9)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
