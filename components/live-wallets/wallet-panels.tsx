"use client";

import { ShieldCheck } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { signedUsd, toneClass } from "./shared";
import { formatUsd } from "@/lib/format";
import type { LiveChain, LiveWalletDetail } from "@/lib/live-wallet-types";
import { cn } from "@/lib/utils";

const SLICE_COLORS = ["#b6f24f", "#6cb8ff", "#f5b73d", "#a98bff", "#ff6b7b"];
const OTHER_COLOR = "#5b7160";
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

function Panel({ title, help, children }: { title: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-[20px] border border-border bg-card p-4 md:p-5">
      <h3 className="text-[15px] font-semibold">
        {title}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </h3>
      {children}
    </section>
  );
}

export function PortfolioCard({ chain }: { chain: LiveChain | null | undefined }) {
  const { slices, total } = chain ? buildSlices(chain) : { slices: [], total: 0 };
  return (
    <Panel title="Portfolio">
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
                <b className="min-w-0 flex-1 truncate font-semibold">{s.name}</b>
                <span className="shrink-0 text-text-2 tabular-nums">
                  {((s.valueUsd / total) * 100).toFixed(1)}% · {formatUsd(s.valueUsd)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-text-2">Nothing priced in this wallet yet.</p>
      )}
    </Panel>
  );
}

export function PnlCard({ pnl }: { pnl: LiveWalletDetail["pnl"] }) {
  const decided = pnl.wins + pnl.losses;
  const winPct = decided ? (pnl.wins / decided) * 100 : 0;
  return (
    <Panel title="Profit & loss">
      <div className="flex flex-col gap-0.5">
        <b className={cn("text-[30px] leading-9 font-semibold tracking-[-0.02em] tabular-nums", toneClass(pnl.realizedPnlUsd))}>{signedUsd(pnl.realizedPnlUsd)}</b>
        <span className="text-xs text-text-3">
          net realized, {pnl.sells} sell{pnl.sells === 1 ? "" : "s"}
        </span>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 text-[13px] tabular-nums">
        <dt className="text-text-2">Total profit</dt>
        <dd className="font-semibold text-positive">{signedUsd(pnl.profitUsd)}</dd>
        <dt className="text-text-2">Total loss</dt>
        <dd className="font-semibold text-negative">{signedUsd(pnl.lossUsd)}</dd>
        <dt className="text-text-2">Unrealized (held)</dt>
        <dd className={cn("font-semibold", toneClass(pnl.unrealizedPnlUsd))}>{signedUsd(pnl.unrealizedPnlUsd)}</dd>
        <dt className="text-text-2">Win rate</dt>
        <dd className="font-semibold">{decided ? `${winPct.toFixed(1)}%` : "—"}</dd>
      </dl>
      {decided ? (
        <div className="h-2 overflow-hidden rounded-full bg-neg-soft" role="img" aria-label={`${pnl.wins} winning sells of ${decided}`}>
          <div className="h-full rounded-full bg-positive" style={{ width: `${winPct}%` }} />
        </div>
      ) : null}
    </Panel>
  );
}

export function SecurityNote() {
  return (
    <div className="flex items-start gap-3 rounded-[20px] border border-border bg-card px-4 py-3.5">
      <ShieldCheck className="mt-0.5 size-5 shrink-0 text-positive" />
      <p className="text-[13px] leading-5 text-text-2">The private key is stored encrypted. Viewing it needs a fresh two-factor code, and every view is logged.</p>
    </div>
  );
}
