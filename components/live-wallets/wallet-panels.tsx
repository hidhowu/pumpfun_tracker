"use client";

import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { signedUsd, toneClass } from "./shared";
import { formatUsd } from "@/lib/format";
import type { LiveChain, LiveWalletDetail } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

const SLICE_COLORS = ["#8b7cff", "#35d6b0", "#ff8a5b", "#f5b83d", "#6d8bff"];
const OTHER_COLOR = "#6b6890";
const MAX_SLICES = 5;

type Slice = { name: string; valueUsd: number; color: string };

/** SOL and each priced token as a share of the wallet; the smallest are folded into "Other" so the legend stays short. */
function buildSlices(chain: LiveChain): { slices: Slice[]; total: number } {
  const all = [
    { name: "SOL", valueUsd: chain.solValueUsd ?? 0 },
    ...chain.tokens.filter((t) => t.valueUsd !== null && t.valueUsd > 0).map((t) => ({ name: t.symbol ?? "Unknown", valueUsd: t.valueUsd as number })),
  ]
    .filter((s) => s.valueUsd > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd);
  const head = all.slice(0, MAX_SLICES);
  const rest = all.slice(MAX_SLICES);
  const slices: Slice[] = head.map((s, i) => ({ ...s, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  if (rest.length) slices.push({ name: "Other", valueUsd: rest.reduce((sum, s) => sum + s.valueUsd, 0), color: OTHER_COLOR });
  return { slices, total: slices.reduce((sum, s) => sum + s.valueUsd, 0) };
}

export function PortfolioCard({ chain }: { chain: LiveChain | null | undefined }) {
  const { slices, total } = chain ? buildSlices(chain) : { slices: [], total: 0 };
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h3 className="text-[15px] font-extrabold">Portfolio</h3>
        {total > 0 ? (
          <>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Share of the wallet by asset">
              {slices.map((s) => (
                <div key={s.name} style={{ width: `${(s.valueUsd / total) * 100}%`, background: s.color }} />
              ))}
            </div>
            <ul className="flex flex-col gap-2.5">
              {slices.map((s) => (
                <li key={s.name} className="flex items-center gap-2.5 text-[13px]">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate font-bold">{s.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {((s.valueUsd / total) * 100).toFixed(1)}% · {formatUsd(s.valueUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing priced in this wallet yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function PnlCard({ pnl }: { pnl: LiveWalletDetail["pnl"] }) {
  const decided = pnl.wins + pnl.losses;
  const winPct = decided ? (pnl.wins / decided) * 100 : 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h3 className="text-[15px] font-extrabold">Profit &amp; loss</h3>
        <div>
          <div className={cn("text-3xl font-extrabold tracking-tight tabular-nums", toneClass(pnl.realizedPnlUsd))}>{signedUsd(pnl.realizedPnlUsd)}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            net realized, {pnl.sells} sell{pnl.sells === 1 ? "" : "s"}
          </div>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 text-[13px] tabular-nums">
          <dt className="text-muted-foreground">Total profit</dt>
          <dd className="font-bold text-positive">{signedUsd(pnl.profitUsd)}</dd>
          <dt className="text-muted-foreground">Total loss</dt>
          <dd className="font-bold text-negative">{signedUsd(pnl.lossUsd)}</dd>
          <dt className="text-muted-foreground">Unrealized (held)</dt>
          <dd className={cn("font-bold", toneClass(pnl.unrealizedPnlUsd))}>{signedUsd(pnl.unrealizedPnlUsd)}</dd>
          <dt className="text-muted-foreground">Win rate</dt>
          <dd className="font-bold">{decided ? `${winPct.toFixed(1)}%` : "-"}</dd>
        </dl>
        {decided ? (
          <div className="h-2 overflow-hidden rounded-full bg-negative/35" role="img" aria-label={`${pnl.wins} winning sells of ${decided}`}>
            <div className="h-full rounded-full bg-positive" style={{ width: `${winPct}%` }} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SecurityNote() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-card/50 px-4 py-3.5">
      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-positive" />
      <p className="text-[13px] leading-relaxed text-muted-foreground">The private key is stored encrypted. Viewing it needs a fresh two-factor code, and every view is logged.</p>
    </div>
  );
}
