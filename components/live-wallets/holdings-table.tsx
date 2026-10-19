"use client";

import { Card } from "@/components/ui/card";
import { BurnTokenAccountButton } from "./burn-token-account";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddressChip, formatAmount, formatPrice, signedPercent, toneClass, tokenLabel, TokenAvatar, TypePill } from "./shared";
import { formatSol, formatUsd } from "@/lib/format";
import type { LiveChain, LiveHolding, LiveTokenAccount } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

const HIDDEN = "••••";
/** What the wallet's SOL row passes to onSelect - SOL has no mint address. */
export const SOL = "SOL";

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">{children}</div>;
}

/** What a holding gained or lost against what it cost - or "Received" when it arrived by transfer and has no cost. */
function PnlCell({ holding }: { holding: LiveHolding }) {
  if (holding.unrealizedPnlUsd === null) return <span className="text-muted-foreground">{holding.balance > 0 ? "No cost" : "-"}</span>;
  return <span className={cn("font-bold", toneClass(holding.unrealizedPnlUsd))}>{signedPercent(holding.unrealizedPnlPct)}</span>;
}

/**
 * SOL first, then every token the wallet holds, biggest value first. Clicking a token opens its history and profit/loss.
 * A real table from tablet width up; a list of rows on phones.
 */
export function HoldingsTable({ chain, onSelect, masked = false }: { chain: LiveChain; onSelect: (mint: string) => void; masked?: boolean }) {
  const hide = (text: string) => (masked ? HIDDEN : text);
  const empty = chain.tokens.length === 0;

  return (
    <Card className="gap-0 py-0">
      {/* Phones */}
      <ul className="divide-y divide-border px-4 md:hidden">
        <li>
          <button type="button" onClick={() => onSelect(SOL)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left">
            <TokenAvatar symbol="SOL" className="size-11" />
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold">Solana</div>
              <div className="truncate text-[13px] text-muted-foreground tabular-nums">{hide(formatSol(chain.solBalance))}</div>
            </div>
            <div className="text-right">
              <div className="text-base font-bold tabular-nums">{hide(formatUsd(chain.solValueUsd))}</div>
              <div className="text-[13px] text-muted-foreground tabular-nums">{formatPrice(chain.solUsd)}</div>
            </div>
          </button>
        </li>
        {chain.tokens.map((t) => (
          <li key={t.mint}>
            <button type="button" onClick={() => onSelect(t.mint)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left">
              <TokenAvatar icon={t.icon} symbol={t.symbol} className="size-11" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-bold">{tokenLabel(t.symbol, t.mint)}</div>
                <div className="truncate text-[13px] text-muted-foreground tabular-nums">{hide(`${formatAmount(t.balance)} ${t.symbol ?? ""}`.trim())}</div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold tabular-nums">{t.valueUsd === null ? <span className="text-sm font-semibold text-muted-foreground">no price</span> : hide(formatUsd(t.valueUsd))}</div>
                <div className="text-[13px] tabular-nums">
                  <PnlCell holding={t} />
                </div>
              </div>
            </button>
          </li>
        ))}
        {empty ? <li className="py-8 text-center text-sm text-muted-foreground">No tokens yet, only SOL. Send some to this wallet&apos;s address to get started.</li> : null}
      </ul>

      {/* Tablet and up */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Token</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="pr-5 text-right">P&amp;L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              tabIndex={0}
              role="button"
              aria-label="Open Solana"
              className="h-16 cursor-pointer focus-visible:bg-accent/30 focus-visible:outline-none"
              onClick={() => onSelect(SOL)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(SOL))}
            >
              <TableCell className="pl-5">
                <div className="flex items-center gap-3">
                  <TokenAvatar symbol="SOL" />
                  <span className="text-[15px] font-extrabold">Solana</span>
                </div>
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{hide(formatSol(chain.solBalance))}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">{formatPrice(chain.solUsd)}</TableCell>
              <TableCell className="text-right font-extrabold tabular-nums">{hide(formatUsd(chain.solValueUsd))}</TableCell>
              <TableCell className="pr-5 text-right text-muted-foreground">-</TableCell>
            </TableRow>
            {chain.tokens.map((t) => (
              <TableRow
                key={t.mint}
                tabIndex={0}
                role="button"
                aria-label={`Open ${t.symbol ?? "token"}`}
                className="h-16 cursor-pointer focus-visible:bg-accent/30 focus-visible:outline-none"
                onClick={() => onSelect(t.mint)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(t.mint))}
              >
                <TableCell className="pl-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <TokenAvatar icon={t.icon} symbol={t.symbol} />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="max-w-44 truncate text-[15px] font-extrabold">{tokenLabel(t.symbol, t.mint)}</span>
                      {t.name ? <span className="max-w-44 truncate text-xs text-muted-foreground">{t.name}</span> : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{hide(formatAmount(t.balance))}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{formatPrice(t.priceUsd)}</TableCell>
                <TableCell className="text-right font-extrabold tabular-nums">{t.valueUsd === null ? <span className="font-semibold text-muted-foreground">no price</span> : hide(formatUsd(t.valueUsd))}</TableCell>
                <TableCell className="pr-5 text-right tabular-nums">
                  <PnlCell holding={t} />
                </TableCell>
              </TableRow>
            ))}
            {empty ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No tokens yet, only SOL. Send some to this wallet&apos;s address to get started.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/** Every token account the wallet owns - including empty ones, which still hold a small refundable rent deposit. */
export function TokenAccountsTable({ walletId, accounts, onSelect, onChanged }: { walletId: string; accounts: LiveTokenAccount[]; onSelect: (mint: string) => void; onChanged: () => void }) {
  if (accounts.length === 0) {
    return (
      <Card className="gap-0 py-0">
        <Empty>This wallet has no token accounts.</Empty>
      </Card>
    );
  }
  return (
    <>
      {/* Phones: one card per account */}
      <div className="flex flex-col gap-3 md:hidden">
        {accounts.map((a) => (
          <div key={a.account} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => onSelect(a.mint)} className="flex min-w-0 items-center gap-2.5 text-left">
                <TokenAvatar icon={a.icon} symbol={a.symbol} className="size-8" />
                <span className="truncate text-[15px] font-bold">{tokenLabel(a.symbol, a.mint)}</span>
              </button>
              <div className="flex items-center gap-1.5">
                <TypePill label={a.program === "token-2022" ? "Token-2022" : "Token"} tone="receive" />
                <BurnTokenAccountButton walletId={walletId} account={a} onDone={onChanged} compact />
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted-foreground">Account</dt>
              <dd className="justify-self-end">
                <AddressChip value={a.account} label="token account address" chars={5} />
              </dd>
              <dt className="text-muted-foreground">Mint</dt>
              <dd className="justify-self-end">
                <AddressChip value={a.mint} kind="token" label="mint address" chars={5} />
              </dd>
              <dt className="text-muted-foreground">Balance</dt>
              <dd className="justify-self-end font-semibold tabular-nums">{formatAmount(a.balance)}</dd>
              <dt className="text-muted-foreground">Rent held</dt>
              <dd className="justify-self-end tabular-nums">{formatSol(a.rentLamports / 1e9)}</dd>
            </dl>
            {a.state === "frozen" ? <TypePill label="Frozen" tone="failed" /> : null}
          </div>
        ))}
      </div>

      {/* Tablet and up */}
      <Card className="hidden gap-0 py-0 md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Token</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Mint</TableHead>
              <TableHead>Program</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Rent</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Burn and close</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.account} className="h-14">
                <TableCell className="pl-5">
                  <button type="button" onClick={() => onSelect(a.mint)} className="flex items-center gap-2.5 text-left hover:text-brand-soft">
                    <TokenAvatar icon={a.icon} symbol={a.symbol} className="size-7" />
                    <span className="max-w-32 truncate font-extrabold">{tokenLabel(a.symbol, a.mint)}</span>
                  </button>
                </TableCell>
                <TableCell>
                  <AddressChip value={a.account} label="token account address" chars={5} />
                </TableCell>
                <TableCell>
                  <AddressChip value={a.mint} kind="token" label="mint address" chars={5} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <TypePill label={a.program === "token-2022" ? "Token-2022" : "Token"} tone="receive" />
                    {a.state === "frozen" ? <TypePill label="Frozen" tone="failed" /> : null}
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatAmount(a.balance)}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">{formatSol(a.rentLamports / 1e9)}</TableCell>
                <TableCell className="pr-4 text-right">
                  <BurnTokenAccountButton walletId={walletId} account={a} onDone={onChanged} compact />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
