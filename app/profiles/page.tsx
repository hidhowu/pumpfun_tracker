"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, Coins, Layers, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/traders/stat-tile";
import { CreateProfileDialog, DeleteProfileDialog } from "@/components/profile-switcher";
import { getProfilesOverview, setDefaultProfile } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useProfile } from "@/lib/profile-context";
import type { ProfileOverview } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;

function pnlTone(n: number) {
  return n > 0 ? "text-positive" : n < 0 ? "text-negative" : undefined;
}

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

/**
 * Every profile side by side: realized P&L, today's P&L, open trades,
 * balance and win rate - plus switching, making a profile the default, and
 * deleting. The default profile can't be deleted, so "Make default" on
 * another profile is how the old default becomes deletable.
 */
export default function ProfilesPage() {
  const { currentProfileId, setCurrentProfileId, refresh: refreshProfiles } = useProfile();
  const [profiles, setProfiles] = useState<ProfileOverview[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProfileOverview | null>(null);

  const load = useCallback(async () => {
    try {
      const { profiles } = await getProfilesOverview();
      setProfiles(profiles);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load profiles");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  async function handleMakeDefault(profile: ProfileOverview) {
    setPendingId(profile._id);
    try {
      await setDefaultProfile(profile._id);
      toast.success(`"${profile.name}" is now the default profile`);
      await Promise.all([load(), refreshProfiles()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to set default profile");
    } finally {
      setPendingId(null);
    }
  }

  const totals = (profiles ?? []).reduce(
    (acc, p) => ({
      open: acc.open + p.openTradeCount,
      realized: acc.realized + p.realizedPnlUsd,
      today: acc.today + p.todayRealizedPnlUsd,
    }),
    { open: 0, realized: 0, today: 0 }
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Layers className="size-4.5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Profiles</h1>
            <p className="text-sm text-muted-foreground">
              Each profile runs its own strategy settings over the same tracked traders. The default profile can&apos;t
              be deleted - make another one the default first.
            </p>
          </div>
        </div>
        <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New profile
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Profiles" value={String(profiles?.length ?? "…")} icon={Layers} />
        <StatTile label="Open trades (all profiles)" value={String(profiles ? totals.open : "…")} icon={ArrowRightLeft} />
        <StatTile
          label="Realized P&L (all profiles)"
          value={profiles ? formatUsd(totals.realized) : "…"}
          icon={Coins}
          tone={totals.realized > 0 ? "positive" : totals.realized < 0 ? "negative" : "default"}
          hint={profiles ? `${formatUsd(totals.today)} today` : undefined}
        />
      </div>

      {!profiles ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {profiles.map((profile) => {
            const isCurrent = profile._id === currentProfileId;
            const busy = pendingId === profile._id;
            return (
              <Card key={profile._id} className={cn("border-border/60", isCurrent && "border-primary/50")}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                    <span className="truncate">{profile.name}</span>
                    {profile.isDefault && (
                      <Badge className="gap-1 border-primary/30 bg-primary/15 text-primary">
                        <Star className="size-3" /> Default
                      </Badge>
                    )}
                    {isCurrent && <Badge variant="outline">Viewing</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Stat label="Realized P&L" value={formatUsd(profile.realizedPnlUsd)} className={pnlTone(profile.realizedPnlUsd)} />
                    <Stat
                      label="Today's P&L"
                      value={
                        <span className="inline-flex flex-col">
                          <span>{formatUsd(profile.todayRealizedPnlUsd)}</span>
                          <span className="text-[11px] font-normal text-muted-foreground">
                            {profile.todayClosedTrades} trade{profile.todayClosedTrades === 1 ? "" : "s"}
                          </span>
                        </span>
                      }
                      className={pnlTone(profile.todayRealizedPnlUsd)}
                    />
                    <Stat label="Open trades" value={profile.openTradeCount} />
                    <Stat label="Sim balance" value={formatUsd(profile.balanceUsd)} />
                    <Stat label="Closed trades" value={profile.closedTradeCount} />
                    <Stat label="Win rate" value={profile.winRatePercent != null ? `${profile.winRatePercent.toFixed(0)}%` : "—"} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    {!isCurrent && (
                      <Button variant="outline" size="sm" onClick={() => setCurrentProfileId(profile._id)}>
                        Switch to
                      </Button>
                    )}
                    {!profile.isDefault && (
                      <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={() => handleMakeDefault(profile)}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Star className="size-3.5" />}
                        Make default
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto gap-1.5 text-muted-foreground hover:text-negative"
                      disabled={profile.isDefault || profiles.length <= 1}
                      title={
                        profile.isDefault
                          ? "The default profile can't be deleted - make another profile the default first"
                          : profiles.length <= 1
                            ? "The last remaining profile can't be deleted"
                            : undefined
                      }
                      onClick={() => setDeleteTarget(profile)}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                  {profile.isDefault && profiles.length > 1 && (
                    <p className="-mt-2 text-xs text-muted-foreground">
                      To delete this profile, click &quot;Make default&quot; on another profile first.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateProfileDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      <DeleteProfileDialog profile={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} onDeleted={load} />
    </div>
  );
}
