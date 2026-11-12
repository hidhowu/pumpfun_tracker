"use client";

import { Layers } from "lucide-react";
import { BurnTokenAccountButton } from "./burn-token-account";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddressChip, formatAmount, formatPrice, signedPercent, toneClass, tokenLabel, TokenAvatar, TypePill } from "./shared";
import { formatSol, formatUsd } from "@/lib/format";
import type { LiveChain, LiveHolding, LiveTokenAccount } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

const HIDDEN = "••••";
/** What the wallet's SOL row passes to onSelect - SOL has no mint address. */
export const SOL = "SOL";

const headCls = "text-[11px] font-medium tracking-[0.07em] text-text-3 uppercase";
const rowFocus = "cursor-pointer border-border focus-visible:bg-accent focus-visible:outline-none";

/** The box a table sits in. */
function Box({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("overflow-hidden rounded-[20px] border border-border bg-card", className)}>{children}</div>;
}

/** What a holding gained or lost against what it cost - or "No cost" when it arrived by transfer. */
function PnlCell({ holding }: { holding: LiveHolding }) {
  if (holding.unrealizedPnlUsd === null) return <span className="text-text-3">{holding.balance > 0 ? "No cost" : "—"}</span>;
  return <span className={cn("font-semibold", toneClass(holding.unrealizedPnlUsd))}>{signedPercent(holding.unrealizedPnlPct)}</span>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center">
      <span className="flex size-[44px] items-center justify-center rounded-2xl bg-surface-3 text-primary">
        <Layers className="size-5" />
      </span>
      <span className="max-w-[420px] text-sm text-text-2">{children}</span>
    </div>
  );
}

/**
 * SOL first, then every token the wallet holds, biggest value first. Clicking a token opens its history and profit/loss.
 * A real table from tablet width up; a list of rows on phones.
 */
export function HoldingsTable({ chain, onSelect, masked = false }: { chain: LiveChain; onSelect: (mint: string) => void; masked?: boolean }) {
  const hide = (text: string) => (masked ? HIDDEN : text);
  const empty = chain.tokens.length === 0;

  return (
    <Box>
      {/* Phones */}
      <ul className="divide-y divide-border px-4 md:hidden">
        <li>
          <button type="button" onClick={() => onSelect(SOL)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left">
            <TokenAvatar symbol="SOL" className="size-10" />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">Solana</div>
              <div className="truncate text-xs text-text-3 tabular-nums">{hide(formatSol(chain.solBalance))}</div>
            </div>
            <div className="text-right">
              <div className="text-[15px] font-semibold tabular-nums">{hide(formatUsd(chain.solValueUsd))}</div>
              <div className="text-xs text-text-3 tabular-nums">{formatPrice(chain.solUsd)}</div>
            </div>
          </button>
        </li>
        {chain.tokens.map((t) => (
          <li key={t.mint}>
            <button type="button" onClick={() => onSelect(t.mint)} className="flex min-h-16 w-full items-center gap-3 py-3 text-left">
              <TokenAvatar icon={t.icon} symbol={t.symbol} className="size-10" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{tokenLabel(t.symbol, t.mint)}</div>
                <div className="truncate text-xs text-text-3 tabular-nums">{hide(`${formatAmount(t.balance)} ${t.symbol ?? ""}`.trim())}</div>
              </div>
              <div className="text-right">
                <div className="text-[15px] font-semibold tabular-nums">{t.valueUsd === null ? <span className="text-[13px] font-normal text-text-3">no price</span> : hide(formatUsd(t.valueUsd))}</div>
                <div className="text-xs tabular-nums">
                  <PnlCell holding={t} />
                </div>
              </div>
            </button>
          </li>
        ))}
        {empty ? <li className="py-8 text-center text-sm text-text-2">No tokens yet, only SOL. Send some to this wallet&apos;s address to get started.</li> : null}
      </ul>

      {/* Tablet and up */}
      <div className="max-md:hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className={cn(headCls, "pl-5")}>Token</TableHead>
              <TableHead className={cn(headCls, "text-right")}>Balance</TableHead>
              <TableHead className={cn(headCls, "text-right")}>Price</TableHead>
              <TableHead className={cn(headCls, "text-right")}>Value</TableHead>
              <TableHead className={cn(headCls, "pr-5 text-right")}>P&amp;L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              tabIndex={0}
              role="button"
              aria-label="Open Solana"
              className={cn("h-[60px]", rowFocus)}
              onClick={() => onSelect(SOL)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(SOL))}
            >
              <TableCell className="pl-5">
                <div className="flex items-center gap-3">
                  <TokenAvatar symbol="SOL" />
                  <div className="flex flex-col leading-tight">
                    <b className="text-sm font-semibold">SOL</b>
                    <span className="text-xs text-text-3">Solana</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right text-[13px] tabular-nums">{hide(formatSol(chain.solBalance))}</TableCell>
              <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{formatPrice(chain.solUsd)}</TableCell>
              <TableCell className="text-right text-[13px] font-semibold tabular-nums">{hide(formatUsd(chain.solValueUsd))}</TableCell>
              <TableCell className="pr-5 text-right text-text-3">—</TableCell>
            </TableRow>
            {chain.tokens.map((t) => (
              <TableRow
                key={t.mint}
                tabIndex={0}
                role="button"
                aria-label={`Open ${t.symbol ?? "token"}`}
                className={cn("h-[60px]", rowFocus)}
                onClick={() => onSelect(t.mint)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(t.mint))}
              >
                <TableCell className="pl-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <TokenAvatar icon={t.icon} symbol={t.symbol} />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <b className="max-w-44 truncate text-sm font-semibold">{tokenLabel(t.symbol, t.mint)}</b>
                      {t.name ? <span className="max-w-44 truncate text-xs text-text-3">{t.name}</span> : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums">{hide(formatAmount(t.balance))}</TableCell>
                <TableCell className="text-right text-[13px] text-text-2 tabular-nums">{formatPrice(t.priceUsd)}</TableCell>
                <TableCell className="text-right text-[13px] font-semibold tabular-nums">{t.valueUsd === null ? <span className="font-normal text-text-3">no price</span> : hide(formatUsd(t.valueUsd))}</TableCell>
                <TableCell className="pr-5 text-right text-[13px] tabular-nums">
                  <PnlCell holding={t} />
                </TableCell>
              </TableRow>
            ))}
            {empty ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-10 text-center text-sm text-text-2">
                  No tokens yet, only SOL. Send some to this wallet&apos;s address to get started.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </Box>
  );
}

/** Every token account the wallet owns - including empty ones, which still hold a small refundable rent deposit. */
export function TokenAccountsTable({ walletId, accounts, onSelect, onChanged }: { walletId: string; accounts: LiveTokenAccount[]; onSelect: (mint: string) => void; onChanged: () => void }) {
  if (accounts.length === 0) {
    return (
      <Box>
        <EmptyState>This wallet has no token accounts.</EmptyState>
      </Box>
    );
  }
  return (
    <>
      {/* Phones: one card per account */}
      <div className="flex flex-col gap-3 md:hidden">
        {accounts.map((a) => (
          <article key={a.account} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => onSelect(a.mint)} className="flex min-w-0 items-center gap-2.5 text-left">
                <TokenAvatar icon={a.icon} symbol={a.symbol} className="size-9" />
                <div className="flex min-w-0 flex-col items-start gap-1">
                  <b className="max-w-full truncate text-[15px] font-semibold">{tokenLabel(a.symbol, a.mint)}</b>
                  <span className="flex items-center gap-1.5">
                    <TypePill label={a.program === "token-2022" ? "Token-2022" : "Token"} tone="receive" />
                    {a.state === "frozen" ? <TypePill label="Frozen" tone="failed" /> : null}
                  </span>
                </div>
              </button>
              <BurnTokenAccountButton walletId={walletId} account={a} onDone={onChanged} compact />
            </div>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-text-3">Account</dt>
              <dd className="justify-self-end">
                <AddressChip value={a.account} label="token account address" chars={4} />
              </dd>
              <dt className="text-text-3">Mint</dt>
              <dd className="justify-self-end">
                <AddressChip value={a.mint} kind="token" label="mint address" chars={4} />
              </dd>
              <dt className="text-text-3">Balance</dt>
              <dd className="justify-self-end font-semibold tabular-nums">{formatAmount(a.balance)}</dd>
              <dt className="text-text-3">Rent held</dt>
              <dd className="justify-self-end text-text-2 tabular-nums">{formatSol(a.rentLamports / 1e9)}</dd>
            </dl>
          </article>
        ))}
      </div>

      {/* Tablet and up */}
      <Box className="max-md:hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className={cn(headCls, "pl-5")}>Token</TableHead>
              <TableHead className={headCls}>Account</TableHead>
              <TableHead className={headCls}>Mint</TableHead>
              <TableHead className={cn(headCls, "text-right")}>Balance</TableHead>
              <TableHead className={cn(headCls, "text-right")}>Rent</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">Burn and close</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => (
              <TableRow key={a.account} className="h-[64px] border-border">
                <TableCell className="pl-5">
                  <button type="button" onClick={() => onSelect(a.mint)} className="flex items-center gap-2.5 text-left hover:text-primary">
                    <TokenAvatar icon={a.icon} symbol={a.symbol} className="size-8" />
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <b className="max-w-32 truncate text-sm font-semibold">{tokenLabel(a.symbol, a.mint)}</b>
                      <span className="flex items-center gap-1.5">
                        <TypePill label={a.program === "token-2022" ? "Token-2022" : "Token"} tone="receive" />
                        {a.state === "frozen" ? <TypePill label="Frozen" tone="failed" /> : null}
                      </span>
                    </span>
                  </button>
                </TableCell>
                <TableCell>
                  <AddressChip value={a.account} label="token account address" chars={4} />
                </TableCell>
                <TableCell>
                  <AddressChip value={a.mint} kind="token" label="mint address" chars={4} />
                </TableCell>
                <TableCell className="text-right text-[13px] tabular-nums">{formatAmount(a.balance)}</TableCell>
                <TableCell className="text-right text-[13px] text-text-3 tabular-nums">{formatSol(a.rentLamports / 1e9)}</TableCell>
                <TableCell className="pr-4 text-right">
                  <BurnTokenAccountButton walletId={walletId} account={a} onDone={onChanged} compact />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </>
  );
}
