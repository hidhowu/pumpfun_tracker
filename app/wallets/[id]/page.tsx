"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, History, LineChart, SlidersHorizontal, Trash2, Users, Wallet as WalletIcon } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { WalletPerformanceTab } from "@/components/wallets/wallet-performance-tab";
import { WalletTradersTab } from "@/components/wallets/wallet-traders-tab";
import { WalletTradeHistory } from "@/components/wallets/wallet-trade-history";
import { WalletSettingsPanel } from "@/components/wallets/wallet-settings-panel";
import { ExportCsvDialog } from "@/components/export-csv-dialog";
import { deleteWallet, getWallet, renameWallet } from "@/lib/api";
import type { WalletView } from "@/lib/types";

const POLL_INTERVAL_MS = 10_000;

export default function WalletDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
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
      setWallet(updated);
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
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit -ml-2 text-muted-foreground">
        <Link href="/wallets">
          <ArrowLeft className="size-4" /> Back to wallets
        </Link>
      </Button>

      {loading && !wallet ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : error && !wallet ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">{error}</div>
      ) : wallet ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <WalletIcon className="size-4.5" />
              </div>
              {editingName ? (
                <Input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => e.key === "Enter" && handleRename()}
                  className="h-8 w-56"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(wallet.name);
                    setEditingName(true);
                  }}
                  className="text-lg font-semibold tracking-tight hover:text-primary"
                >
                  {wallet.name}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
            <ExportCsvDialog
              endpoint={`/api/wallets/${wallet._id}/export`}
              title={`Export wallet "${wallet.name}"`}
              description="Every trader's trades on this wallet since they were added - per hour, per day, or per trade, with a per-trader summary (win rate, P&L, win/loss days)."
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={deleting} className="text-muted-foreground hover:text-negative">
                  <Trash2 className="size-4" /> Delete wallet
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &quot;{wallet.name}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes this wallet, every trader assignment, position, and trade history under
                    it. This cannot be undone. The assigned traders&apos; own tracking (and any Profile simulation) is
                    untouched.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-negative text-negative-foreground hover:bg-negative/90" onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            </div>
          </div>

          <Tabs defaultValue="performance" className="flex flex-col gap-4">
            <TabsList>
              <TabsTrigger value="performance" className="gap-1.5">
                <LineChart className="size-3.5" /> Performance
              </TabsTrigger>
              <TabsTrigger value="traders" className="gap-1.5">
                <Users className="size-3.5" /> Traders Performance
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="size-3.5" /> Trade History
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5">
                <SlidersHorizontal className="size-3.5" /> Settings
              </TabsTrigger>
            </TabsList>

            <TabsContent value="performance">
              <WalletPerformanceTab wallet={wallet} />
            </TabsContent>

            <TabsContent value="traders">
              <WalletTradersTab walletId={wallet._id} />
            </TabsContent>

            <TabsContent value="history">
              <WalletTradeHistory walletId={wallet._id} />
            </TabsContent>

            <TabsContent value="settings">
              <WalletSettingsPanel
                walletId={wallet._id}
                settings={wallet.settings}
                lastAutoResetAt={wallet.lastAutoResetAt}
                onUpdated={(settings) => setWallet((prev) => (prev ? { ...prev, settings } : prev))}
                onReset={(updated) => setWallet(updated)}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
