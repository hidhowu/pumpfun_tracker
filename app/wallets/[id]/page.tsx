"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, History, LineChart, Loader2, Pencil, SlidersHorizontal, Trash2, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WalletPerformanceTab } from "@/components/wallets/wallet-performance-tab";
import { WalletTradersTab } from "@/components/wallets/wallet-traders-tab";
import { WalletTradeHistory } from "@/components/wallets/wallet-trade-history";
import { WalletSettingsPanel } from "@/components/wallets/wallet-settings-panel";
import { LinkedLiveCard } from "@/components/wallets/linked-live-card";
import { PanicBar } from "@/components/wallets/panic-bar";
import { traderTint } from "@/components/traders/trader-avatar";
import { ExportCsvDialog } from "@/components/export-csv-dialog";
import { deleteWallet, getWallet, renameWallet } from "@/lib/api";
import { formatRelativeTime, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WalletView } from "@/lib/types";

const POLL_INTERVAL_MS = 10_000;

const TABS = [
  { value: "performance", label: "Performance", short: "Perf", icon: LineChart },
  { value: "traders", label: "Traders Performance", short: "Traders", icon: Users },
  { value: "history", label: "Trade History", short: "History", icon: History },
  { value: "settings", label: "Settings", short: "Settings", icon: SlidersHorizontal },
] as const;

export default function WalletDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { wallet } = await getWallet(id);
      setWallet(wallet);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed || !wallet || trimmed === wallet.name) {
      setEditingName(false);
      return;
    }
    try {
      const { wallet: updated } = await renameWallet(id, trimmed);
      setWallet((prev) => (prev ? { ...prev, ...updated, traderCount: prev.traderCount } : updated));
      toast.success("Wallet renamed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename wallet");
    } finally {
      setEditingName(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteWallet(id);
      toast.success("Wallet deleted");
      router.push("/wallets");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete wallet");
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <Link href="/wallets" className="flex w-fit items-center gap-1.5 text-[13px] text-text-2 hover:text-foreground">
        <ChevronLeft className="size-3.5" /> Back to wallets
      </Link>

      {loading && !wallet ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-14 w-full rounded-[20px]" />
          <Skeleton className="h-64 w-full rounded-[20px]" />
        </div>
      ) : error && !wallet ? (
        <div role="alert" className="flex items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-4 text-sm text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          {error}
        </div>
      ) : wallet ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-center gap-3 md:gap-4">
              <span
                aria-hidden
                className="inline-flex size-12 shrink-0 items-center justify-center rounded-[15px] font-mono text-sm font-semibold text-primary-foreground md:size-16 md:rounded-[20px] md:text-lg"
                style={{ background: traderTint(wallet.name) }}
              >
                {wallet.name
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                {editingName ? (
                  <Input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    aria-label="Wallet name"
                    className="h-9 w-56"
                  />
                ) : (
                  <button
                    type="button"
                    aria-label="Rename wallet"
                    title="Click to rename"
                    onClick={() => {
                      setNameDraft(wallet.name);
                      setEditingName(true);
                    }}
                    className="group flex min-w-0 items-center gap-2 text-left text-[22px] leading-7 font-semibold tracking-[-0.02em] hover:text-primary md:text-[28px] md:leading-[34px]"
                  >
                    <span className="truncate">{wallet.name}</span>
                    <Pencil className="size-4 shrink-0 text-text-3 group-hover:text-primary" />
                  </button>
                )}
                <span className="text-xs text-text-3">
                  {wallet.traderCount ?? 0} trader{wallet.traderCount === 1 ? "" : "s"} · started {formatUsd(wallet.startingBalanceUsd)} · created {formatRelativeTime(wallet.createdAt)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ExportCsvDialog
                endpoint={`/api/wallets/${wallet._id}/export`}
                title={`Export wallet "${wallet.name}"`}
                description="Every trader's trades on this wallet since they were added - per hour, per day, or per trade, with a per-trader summary (win rate, P&L, win/loss days)."
              />
              <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(true)} className="gap-1.5 text-text-2 hover:text-negative">
                <Trash2 className="size-4" /> Delete wallet
              </Button>
            </div>
          </div>

          {wallet.panic && (
            <section
              className={cn(
                "rounded-[20px] border p-4 md:p-5",
                wallet.panic.panic ? "border-destructive/50 bg-neg-soft shadow-[0_0_0_1px_rgba(255,107,123,0.35)]" : "border-border bg-card"
              )}
            >
              <PanicBar panic={wallet.panic} />
            </section>
          )}

          <LinkedLiveCard walletId={wallet._id} />

          <Tabs defaultValue="performance" className="flex flex-col gap-4 md:gap-5">
            {/* Wide screens: underlined tabs with icons (and how many traders). */}
            <TabsList variant="line" className="hidden h-11 w-full gap-1 border-b border-border p-0 md:flex">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="h-11 flex-none gap-2 rounded-none px-3.5 text-sm font-medium after:inset-x-2.5 group-data-horizontal/tabs:after:bottom-0 data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:bg-primary"
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                  {t.value === "traders" ? <span className="rounded-full bg-surface-3 px-1.5 py-px text-[11px] font-normal text-text-2">{wallet.traderCount ?? 0}</span> : null}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* Phone: four equal buttons. */}
            <TabsList className="grid h-auto w-full grid-cols-4 md:hidden">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="h-11 justify-center px-0">
                  {t.short}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="performance">
              <WalletPerformanceTab wallet={wallet} />
            </TabsContent>

            <TabsContent value="traders">
              <WalletTradersTab walletId={wallet._id} onChanged={refresh} />
            </TabsContent>

            <TabsContent value="history">
              <WalletTradeHistory walletId={wallet._id} />
            </TabsContent>

            <TabsContent value="settings">
              <WalletSettingsPanel
                walletId={wallet._id}
                settings={wallet.settings}
                lastAutoResetAt={wallet.lastAutoResetAt}
                onUpdated={(settings, updated) => setWallet((prev) => (prev ? { ...prev, settings, panic: updated ? updated.panic : prev.panic } : prev))}
                onReset={(updated) => setWallet((prev) => (prev ? { ...prev, ...updated, traderCount: prev.traderCount } : updated))}
              />
            </TabsContent>
          </Tabs>

          <AlertDialog open={confirmDelete} onOpenChange={(open) => !deleting && setConfirmDelete(open)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &quot;{wallet.name}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>
                  Permanently deletes this wallet with all its trader assignments, positions and history. Cannot be undone. The assigned traders&apos; own tracking (and any Profile simulation) is untouched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleDelete();
                  }}
                >
                  {deleting && <Loader2 className="animate-spin" />}
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
