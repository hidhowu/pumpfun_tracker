"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Layers, ListChecks, Radar, Search, Wallet, Zap, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/shell/shortcuts";
import { ALL_PAGES } from "@/components/shell/nav";
import { listTraderLists, listTraders, listWallets } from "@/lib/api";
import { listLiveWallets } from "@/lib/live-wallet-api";
import { useProfile } from "@/lib/profile-context";
import { formatAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

type Entry = { id: string; group: string; label: string; hint?: string; href: string; icon: LucideIcon; /** Extra text the search also matches. */ haystack: string };

/** A Solana address: 32-44 base58 characters. Pasting one offers to open that trader. */
const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_SHOWN = 8;

/**
 * The "jump to" menu (Cmd/Ctrl+K): pages always, plus traders, lists, sim and live wallets once loaded - loaded the first time the menu opens,
 * so nothing extra is fetched until someone uses it.
 */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { currentProfileId } = useProfile();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const fetched = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const key = currentProfileId ?? "none";
    if (fetched.current === key) return;
    fetched.current = key;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [traders, lists, wallets, live] = await Promise.all([
        currentProfileId ? listTraders(currentProfileId, "active").catch(() => null) : Promise.resolve(null),
        listTraderLists().catch(() => null),
        listWallets().catch(() => null),
        listLiveWallets().catch(() => null),
      ]);
      if (cancelled) return;
      const entries: Entry[] = [];
      for (const t of traders?.traders ?? []) entries.push({ id: `t-${t._id}`, group: "Traders", label: t.label || formatAddress(t.address, 6), hint: formatAddress(t.address, 5), href: `/traders/${t.address}`, icon: Radar, haystack: `${t.label} ${t.address}` });
      for (const l of lists?.lists ?? []) entries.push({ id: `l-${l._id}`, group: "Lists", label: l.name, hint: `${l.memberCount} traders`, href: `/lists/${l._id}`, icon: ListChecks, haystack: l.name });
      for (const w of wallets?.wallets ?? []) entries.push({ id: `w-${w._id}`, group: "Sim wallets", label: w.name, href: `/wallets/${w._id}`, icon: Wallet, haystack: w.name });
      for (const w of live?.wallets ?? []) entries.push({ id: `v-${w._id}`, group: "Live wallets", label: w.name, hint: formatAddress(w.address, 4), href: `/live-wallets/${w._id}`, icon: Zap, haystack: `${w.name} ${w.address}` });
      setLoaded(entries);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentProfileId]);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    const pages: Entry[] = ALL_PAGES.map((p) => ({ id: `p-${p.href}`, group: "Pages", label: p.label, hint: p.section, href: p.href, icon: p.icon, haystack: `${p.label} ${p.section}` }));
    const pool = needle ? [...pages, ...loaded] : pages;
    const matched = needle ? pool.filter((e) => e.haystack.toLowerCase().includes(needle)) : pool;
    const out: Entry[] = [];
    const perGroup = new Map<string, number>();
    const rawAddress = query.trim();
    if (ADDRESS_RE.test(rawAddress)) out.push({ id: "addr", group: "Open", label: `Trader ${formatAddress(rawAddress, 6)}`, hint: "open its page", href: `/traders/${rawAddress}`, icon: Layers, haystack: "" });
    for (const e of matched) {
      const n = perGroup.get(e.group) ?? 0;
      if (needle && n >= MAX_SHOWN) continue;
      perGroup.set(e.group, n + 1);
      out.push(e);
    }
    return out;
  }, [needle, query, loaded]);

  const current = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function go(entry: Entry | undefined) {
    if (!entry) return;
    onOpenChange(false);
    router.push(entry.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(current + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[current]);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-[560px]">
        <DialogTitle className="sr-only">Jump to</DialogTitle>
        <DialogDescription className="sr-only">Search pages, traders, lists and wallets, or paste a trader address.</DialogDescription>
        <label className="-mx-1 flex h-12 items-center gap-2.5 rounded-[14px] border border-line-2 bg-surface-2 px-3.5 text-text-3 focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/50">
          <Search className="size-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search address, wallet, token…"
            aria-label="Jump to"
            className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-text-3 md:text-sm"
          />
        </label>
        <div ref={listRef} role="listbox" aria-label="Results" className="-mx-2 flex max-h-[min(55dvh,420px)] flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-text-3">{loading ? "Searching…" : "Nothing matches that."}</p>
          ) : (
            results.map((entry, i) => (
              <div key={entry.id}>
                {i === 0 || results[i - 1].group !== entry.group ? <b className="block px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-text-3 uppercase">{entry.group}</b> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === current}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(entry)}
                  className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors", i === current ? "bg-surface-4 text-foreground" : "text-text-2")}
                >
                  <entry.icon className={cn("size-4 shrink-0", i === current ? "text-primary" : "text-text-3")} />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.hint ? <span className="shrink-0 text-xs text-text-3">{entry.hint}</span> : null}
                  {i === current ? <CornerDownLeft className="size-3.5 shrink-0 text-text-3 max-sm:hidden" /> : null}
                </button>
              </div>
            ))
          )}
          {loading && results.length > 0 && needle ? <p className="px-3 py-2 text-xs text-text-3">Loading traders and wallets…</p> : null}
        </div>
        <div className="-mb-1 flex items-center gap-3 text-xs text-text-3 max-sm:hidden">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
