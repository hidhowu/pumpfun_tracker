"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRightLeft, Coins, Layers, Loader2, Plus, SlidersHorizontal, Star, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/traders/stat-tile";
import { traderTint } from "@/components/traders/trader-avatar";
import { CreateProfileDialog, DeleteProfileDialog } from "@/components/profile-switcher";
import { getProfilesOverview, setDefaultProfile } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { useProfile } from "@/lib/profile-context";
import type { ProfileOverview } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;

const pnlTone = (n: number) => (n > 0 ? "text-positive" : n < 0 ? "text-negative" : undefined);
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;

function Stat({ label, short, value, className, wrapClassName }: { label: string; short?: string; value: React.ReactNode; className?: string; wrapClassName?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wrapClassName)}>
      <span className="truncate text-xs text-text-3">
        {short ? <span className="md:hidden">{short}</span> : null}
        <span className={cn(short && "max-md:hidden")}>{label}</span>
      </span>
      <span className={cn("text-sm font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

function DefaultBadge() {
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-full border border-volt-line bg-volt-soft px-2 text-[11.5px] font-medium text-primary">
      <Star className="size-3" /> Default
    </span>
  );
}

function ViewingBadge() {
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-line-2 bg-surface-3 px-2 text-[11.5px] font-medium text-text-2">
      <span className="size-1.5 rounded-full bg-positive" /> Viewing
    </span>
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
  const [loadError, setLoadError] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProfileOverview | null>(null);

  const load = useCallback(async () => {
    try {
      const { profiles } = await getProfilesOverview();
      setProfiles(profiles);
      setLoadError(false);
    } catch (e) {
      setLoadError(true);
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

  const help = <HelpTip>Each profile runs its own strategy over the same tracked traders. The default profile can&apos;t be deleted.</HelpTip>;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-4 md:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="hidden text-[28px] leading-[34px] font-semibold tracking-[-0.025em] md:block">
          Profiles
          {help}
        </h1>
        <span className="flex items-center gap-1 text-[13px] text-text-3 md:hidden">
          Strategies over the same traders
          {help}
        </span>
        <Button size="lg" className="gap-1.5 max-md:w-full md:h-9 md:rounded-[10px] md:px-3.5 md:text-[13px]" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" strokeWidth={2.2} /> New profile
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <div className="max-md:hidden">
          <StatTile label="Profiles" value={String(profiles?.length ?? "…")} icon={Layers} />
        </div>
        <StatTile label="Open trades (all profiles)" value={String(profiles ? totals.open : "…")} icon={ArrowRightLeft} />
        <StatTile
          label="Realized P&L (all profiles)"
          value={profiles ? signedUsd(totals.realized) : "…"}
          icon={Coins}
          tone={totals.realized > 0 ? "positive" : totals.realized < 0 ? "negative" : "default"}
          hint={profiles ? `${signedUsd(totals.today)} today` : undefined}
        />
      </div>

      {loadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] text-[#ffc9d0]">
          <TriangleAlert className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">
            <b>Couldn&apos;t load the profiles.</b> {profiles ? "Showing the last data received." : "Try again in a moment."}
          </span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {!profiles ? (
        !loadError && (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-[200px] w-full rounded-[20px]" />
            ))}
          </div>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 md:gap-4">
          {profiles.map((profile) => {
            const isCurrent = profile._id === currentProfileId;
            const busy = pendingId === profile._id;
            const cannotDelete = profile.isDefault || profiles.length <= 1;
            const deleteTip = profile.isDefault
              ? "The default profile can't be deleted - make another profile the default first"
              : profiles.length <= 1
                ? "The last remaining profile can't be deleted"
                : undefined;
            return (
              <article key={profile._id} className={cn("flex min-w-0 flex-col overflow-hidden rounded-[20px] border bg-card", isCurrent ? "border-volt-line" : "border-border")}>
                <div className="flex items-center gap-3 px-4 pt-4 md:px-5 md:pt-5">
                  <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl font-mono text-[13px] font-semibold text-primary-foreground md:hidden" style={{ background: traderTint(profile.name) }}>
                    {profile.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
                    <Link href={`/profiles/${profile._id}`} className="max-w-full truncate text-[15px] font-semibold hover:text-primary">
                      {profile.name}
                    </Link>
                    {profile.isDefault && <DefaultBadge />}
                    {isCurrent && <ViewingBadge />}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-x-4 gap-y-4 p-4 md:p-5">
                  <Stat label="Realized P&L" short="Realized" value={signedUsd(profile.realizedPnlUsd)} className={pnlTone(profile.realizedPnlUsd)} />
                  <Stat
                    label="Today's P&L"
                    short="Today"
                    value={
                      <span className="inline-flex flex-col">
                        <span>{signedUsd(profile.todayRealizedPnlUsd)}</span>
                        <span className="text-[11px] font-normal text-text-3 max-md:hidden">
                          {profile.todayClosedTrades} trade{profile.todayClosedTrades === 1 ? "" : "s"}
                        </span>
                      </span>
                    }
                    className={pnlTone(profile.todayRealizedPnlUsd)}
                  />
                  <Stat label="Win rate" short="Win" value={profile.winRatePercent != null ? `${profile.winRatePercent.toFixed(0)}%` : "—"} wrapClassName="md:order-last" />
                  <Stat label="Open trades" value={profile.openTradeCount} wrapClassName="max-md:hidden" />
                  <Stat label="Sim balance" value={formatUsd(profile.balanceUsd)} wrapClassName="max-md:hidden" />
                  <Stat label="Closed trades" value={profile.closedTradeCount} wrapClassName="max-md:hidden" />
                </div>

                <div className="mt-auto flex flex-col gap-2 border-t border-border p-4 md:px-5 md:py-3.5">
                  <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center">
                    <Button variant="outline" className="h-11 gap-1.5 md:h-[30px] md:rounded-lg md:px-2.5 md:text-xs" asChild>
                      <Link href={`/profiles/${profile._id}`}>
                        <SlidersHorizontal className="size-3.5" /> Settings
                      </Link>
                    </Button>
                    {!isCurrent && (
                      <Button variant="outline" className="h-11 md:h-[30px] md:rounded-lg md:px-2.5 md:text-xs" onClick={() => setCurrentProfileId(profile._id)}>
                        Switch to
                      </Button>
                    )}
                    {!profile.isDefault && (
                      <Button variant="outline" className="h-11 gap-1.5 md:h-[30px] md:rounded-lg md:px-2.5 md:text-xs" disabled={busy} onClick={() => handleMakeDefault(profile)}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Star className="size-3.5" />}
                        Make default
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="h-11 gap-1.5 text-text-3 hover:text-negative md:ml-auto md:h-[30px] md:rounded-lg md:px-2.5 md:text-xs"
                      disabled={cannotDelete}
                      title={deleteTip}
                      onClick={() => setDeleteTarget(profile)}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                  {profile.isDefault && profiles.length > 1 && (
                    <p className="text-xs text-text-3 md:hidden">To delete this profile, make another profile the default first.</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <CreateProfileDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      <DeleteProfileDialog profile={deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} onDeleted={load} />
    </div>
  );
}
