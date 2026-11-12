"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Check, Equal, Flame, Minus, Snowflake, TrendingUp, TriangleAlert, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getHourlyPnl, getPnl, type HourlyPnl } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DailyPnl, PnlBreakdown as PnlBreakdownType } from "@/lib/types";

type Props = { address: string };
type Period = "day" | "week" | "month";
type NegativeDay = PnlBreakdownType["negativeBalanceBreakdown"][number];

const toneText = (n: number | null | undefined) => (n == null || n === 0 ? "text-text-3" : n > 0 ? "text-positive" : "text-negative");

// Calendar colours: two strengths of green / red, quiet for days without trades.
function cellColors(day: DailyPnl) {
  if (day.closedTradeCount === 0 || day.combinedPercent === 0) return { bg: "#141b16", fg: "#7e8f83", none: true };
  const abs = Math.abs(day.combinedPercent);
  if (day.combinedPercent > 0) return { bg: abs > 15 ? "#1d6f55" : "#174d3d", fg: "#eef4ef", none: false };
  return { bg: abs > 8 ? "#7c2f3a" : "#4d2630", fg: "#eef4ef", none: false };
}

function cellText(day: DailyPnl) {
  if (day.closedTradeCount === 0 || day.combinedPercent === 0) return { text: "—", size: 20 };
  const abs = Math.abs(day.combinedPercent);
  const text = `${day.combinedPercent > 0 ? "+" : "−"}${abs >= 100 ? Math.round(abs).toLocaleString("en-US") : abs.toFixed(abs < 10 ? 1 : 0)}%`;
  const len = text.length;
  return { text, size: len <= 4 ? 20 : len === 5 ? 18 : len === 6 ? 15 : 13 };
}

function prettyDay(date: string, withYear = false) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
}

export function PnlBreakdown({ address }: Props) {
  const { currentProfileId } = useProfile();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<PnlBreakdownType | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const wide = useMediaQuery("(min-width: 1024px)");

  const load = useCallback(
    async (p: Period) => {
      if (!currentProfileId) return;
      setLoading(true);
      try {
        const res = await getPnl(currentProfileId, address, p);
        setData(res);
      } finally {
        setLoading(false);
      }
    },
    [currentProfileId, address]
  );

  useEffect(() => {
    load(period);
  }, [load, period]);

  const days = data?.dailyBreakdown ?? [];
  const selectedIndex = selectedDate ? days.findIndex((d) => d.date === selectedDate) : -1;
  const selectedDay = selectedIndex >= 0 ? days[selectedIndex] : null;
  const negativeFor = (date: string): NegativeDay | undefined => data?.negativeBalanceBreakdown.find((n) => n.date === date && n.count > 0);

  const detail = selectedDay ? (
    <DayDetail
      address={address}
      day={selectedDay}
      negative={negativeFor(selectedDay.date)}
      onClose={() => setSelectedDate(null)}
      onPrev={selectedIndex > 0 ? () => setSelectedDate(days[selectedIndex - 1].date) : undefined}
      onNext={selectedIndex < days.length - 1 ? () => setSelectedDate(days[selectedIndex + 1].date) : undefined}
      sheet={!wide}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-0.5 rounded-xl border border-border bg-card p-[3px] max-md:grid max-md:w-full max-md:grid-cols-3" role="group" aria-label="Period">
          {(["day", "week", "month"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={cn("h-[30px] rounded-[9px] px-3.5 text-[13px] font-medium capitalize transition-colors max-md:h-10", period === p ? "bg-surface-4 text-foreground" : "text-text-2 hover:text-foreground")}>
              {p}
            </button>
          ))}
        </div>
        <span className="max-md:hidden">
          <HelpTip>Actualized (portfolio value) vs combined (closed-trade returns).</HelpTip>
        </span>
      </div>

      {loading && !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full rounded-[20px]" />
          <Skeleton className="h-64 w-full rounded-[20px]" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <Tile label="Actualized" value={data.actualizedUsd !== null ? formatUsd(data.actualizedUsd) : "—"} hint="Start-of-period vs now, incl. open positions" tone={toneText(data.actualizedUsd)} icon={TrendingUp} />
            <Tile label="Combined" value={`${data.combinedPercent >= 0 ? "+" : ""}${data.combinedPercent.toFixed(1)}%`} hint="Sum of each closed trade's % return" tone={toneText(data.combinedPercent)} icon={Equal} />
            <Tile label="Closed trades" value={String(data.closedTradeCount)} hint={`${data.averageTradesPerDay.toFixed(1)} / day avg`} icon={Check} />
            <StreakTile streak={data.streaks.currentStreak} />
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex h-[22px] items-center rounded-full border border-positive/30 bg-pos-soft px-2 text-[11.5px] font-medium text-positive">Profitable days · {data.streaks.profitableDays}</span>
            <span className="inline-flex h-[22px] items-center rounded-full border border-destructive/30 bg-neg-soft px-2 text-[11.5px] font-medium text-destructive">Loss days · {data.streaks.lossDays}</span>
            <span className="inline-flex h-[22px] items-center rounded-full border border-line-2 bg-surface-3 px-2 text-[11.5px] font-medium text-text-2">Longest win streak · {data.streaks.longestProfitStreak}d</span>
            <span className="inline-flex h-[22px] items-center rounded-full border border-line-2 bg-surface-3 px-2 text-[11.5px] font-medium text-text-2">Longest loss streak · {data.streaks.longestLossStreak}d</span>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
            <section className="overflow-hidden rounded-[20px] border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5 md:py-4">
                <div className="flex flex-col">
                  <b className="text-[15px] font-semibold">Daily results</b>
                  <span className="text-xs text-text-3">Tap a square to see that day&apos;s hourly profit bars</span>
                </div>
                <div className="flex flex-wrap gap-4 text-[12.5px] text-text-2 max-md:hidden">
                  <Legend color="#1d6f55" label="profit" />
                  <Legend color="#7c2f3a" label="loss" />
                  <Legend color="#1a231c" label="no trades" border />
                </div>
              </div>
              <div className="flex flex-col gap-2 p-3.5 md:gap-3 md:p-5">
                <div className="grid grid-cols-7 gap-[5px] text-center text-xs text-text-3 md:gap-2">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <span key={d}>
                      <span className="md:hidden">{d[0]}</span>
                      <span className="max-md:hidden">{d}</span>
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-[5px] md:gap-2" role="grid" aria-label="Daily results">
                  {days.length > 0 &&
                    Array.from({ length: (new Date(`${days[0].date}T00:00:00Z`).getUTCDay() + 6) % 7 }).map((_, i) => <span key={`pad-${i}`} aria-hidden />)}
                  {days.map((day) => {
                    const colors = cellColors(day);
                    const text = cellText(day);
                    const warn = !!negativeFor(day.date);
                    const isSelected = day.date === selectedDate;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`${prettyDay(day.date)}: ${colors.none ? "no trades" : text.text}${warn ? ", balance went negative" : ""}`}
                        onClick={() => setSelectedDate(isSelected ? null : day.date)}
                        style={{ background: colors.bg, color: colors.fg }}
                        className={cn(
                          "relative flex h-11 min-w-0 flex-col items-stretch justify-between overflow-hidden rounded-[5px] border border-transparent px-[3px] pt-[5px] pb-1.5 md:h-24 md:px-2.5 md:pt-[9px] md:pb-2.5",
                          colors.none && "border-line",
                          isSelected && "border-primary shadow-[0_0_0_3px_rgba(182,242,79,0.3)]"
                        )}
                      >
                        <span className="font-mono text-[8px] leading-none opacity-80 md:text-[10px]">{Number(day.date.slice(8))}</span>
                        <b className={cn("m-auto max-w-full self-center font-mono leading-none font-semibold tracking-[-0.04em] whitespace-nowrap max-md:!text-[10px]", colors.none && "font-medium opacity-60")} style={{ fontSize: text.size }}>
                          {text.text}
                        </b>
                        {warn ? <i className="absolute top-1 right-1 size-1.5 rounded-full bg-negative md:top-1.5 md:right-[7px]" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <div className="flex flex-col gap-4">
              {wide ? (
                detail ?? (
                  <div className="rounded-[18px] border border-dashed border-line-3 bg-card/50 p-4 text-[13px] text-text-3">Pick a day on the calendar to see its details.</div>
                )
              ) : null}
              <CumulativeChart days={days} />
            </div>
          </div>

          {!wide && detail}
        </>
      ) : null}
    </div>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={cn("size-2.5 rounded-[3px]", border && "border border-line-2")} style={{ background: color }} />
      {label}
    </span>
  );
}

function Tile({ label, value, hint, tone, icon: Icon }: { label: string; value: string; hint: string; tone?: string; icon: typeof TrendingUp }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[20px] border border-border bg-card p-3.5 sm:gap-2.5 sm:px-5 sm:py-[18px]">
      <div className="flex items-center justify-between gap-2 text-xs text-text-2 sm:text-[13px]">
        <span className="truncate">{label}</span>
        <span className={cn("hidden size-[30px] shrink-0 items-center justify-center rounded-[10px] bg-surface-3 sm:inline-flex", tone ?? "text-text-2")}>
          <Icon className="size-4" />
        </span>
      </div>
      <span className={cn("truncate text-xl font-semibold tracking-[-0.02em] tabular-nums sm:text-2xl", tone)}>{value}</span>
      <span className="truncate text-xs text-text-3">{hint}</span>
    </div>
  );
}

function StreakTile({ streak }: { streak: PnlBreakdownType["streaks"]["currentStreak"] }) {
  const Icon = streak.type === "profit" ? Flame : streak.type === "loss" ? Snowflake : Minus;
  const tone = streak.type === "profit" ? "text-positive" : streak.type === "loss" ? "text-negative" : "text-text-3";
  return <Tile label="Current streak" value={`${streak.length}d`} hint={streak.type === "none" ? "No active streak" : `${streak.length}-day ${streak.type} streak`} tone={tone} icon={Icon} />;
}

/** The day's details: combined %, trades, wins/losses, hourly profit bars and a negative-balance note. A card beside the calendar on wide screens, a bottom sheet on phones. */
function DayDetail({
  address,
  day,
  negative,
  onClose,
  onPrev,
  onNext,
  sheet,
}: {
  address: string;
  day: DailyPnl;
  negative?: NegativeDay;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  sheet: boolean;
}) {
  const { currentProfileId } = useProfile();
  const [hourly, setHourly] = useState<HourlyPnl | null>(null);

  useEffect(() => {
    if (!currentProfileId) return;
    let cancelled = false;
    getHourlyPnl(currentProfileId, address, day.date)
      .then((res) => !cancelled && setHourly(res))
      .catch(() => !cancelled && setHourly({ date: day.date, hours: [] }));
    return () => {
      cancelled = true;
    };
  }, [currentProfileId, address, day.date]);

  const hours = hourly?.date === day.date ? hourly.hours : null;
  const maxAbs = hours ? Math.max(...hours.map((h) => Math.abs(h.pnlUsd)), 0.01) : 1;

  const body = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2.5">
        <Kv label="Combined" value={day.closedTradeCount > 0 ? `${day.combinedPercent >= 0 ? "+" : ""}${day.combinedPercent.toFixed(1)}%` : "—"} tone={toneText(day.closedTradeCount > 0 ? day.combinedPercent : null)} />
        <Kv label="Closed" value={`${day.closedTradeCount} trade${day.closedTradeCount === 1 ? "" : "s"}`} />
        <Kv label="W / L" value={`${day.wins} / ${day.losses}`} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-text-3">Realized P&amp;L by hour (UTC)</span>
        <div className="flex h-[70px] items-end gap-[3px]" role="img" aria-label="Realized P&L by hour">
          {(hours ?? Array.from({ length: 24 }, (_, hour) => ({ hour, pnlUsd: 0, trades: 0 }))).map((h) => (
            <Tooltip key={h.hour}>
              <TooltipTrigger asChild>
                <i className="block flex-1 rounded-t-[3px]" style={{ height: `${h.pnlUsd === 0 ? 4 : Math.max(8, (Math.abs(h.pnlUsd) / maxAbs) * 100)}%`, background: h.pnlUsd === 0 ? "#222e25" : h.pnlUsd > 0 ? "#35d49a" : "#ff6b7b" }} />
              </TooltipTrigger>
              <TooltipContent>
                {String(h.hour).padStart(2, "0")}:00 · {h.trades} trade{h.trades === 1 ? "" : "s"} · {formatUsd(h.pnlUsd)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="flex justify-between text-xs text-text-3">
          <span>00:00</span>
          <span>12:00</span>
          <span>23:00</span>
        </div>
      </div>
      {negative && (
        <div className="flex items-start gap-2 rounded-[14px] border border-destructive/30 bg-neg-soft px-3 py-2 text-xs text-[#ffc9d0]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <span>
            Balance went negative {negative.count} time{negative.count === 1 ? "" : "s"} — deepest point {formatUsd(-Math.abs(negative.maxDepthUsd))}
          </span>
        </div>
      )}
    </div>
  );

  if (sheet) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>{prettyDay(day.date)}</DialogTitle>
            <DialogDescription>Day detail</DialogDescription>
          </DialogHeader>
          {body}
          <div className="flex gap-2.5">
            <Button variant="outline" size="lg" className="flex-1" disabled={!onPrev} onClick={onPrev} aria-label="Previous day">
              <ChevronLeft /> Previous
            </Button>
            <Button variant="outline" size="lg" className="flex-1" disabled={!onNext} onClick={onNext} aria-label="Next day">
              Next <ChevronRight />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="rounded-[18px] border border-line-3 bg-surface-3 p-4 shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <b className="text-[13px] font-semibold">{prettyDay(day.date, true)}</b>
          <span className="text-xs text-text-3">Day detail</span>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close day detail">
          <X />
        </Button>
      </div>
      {body}
    </div>
  );
}

function Kv({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11.5px] text-text-3">{label}</span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", tone)}>{value}</span>
    </div>
  );
}

/** Running total of each day's combined % over the period, as a line with a soft fill. */
function CumulativeChart({ days }: { days: DailyPnl[] }) {
  const W = 640;
  const H = 170;
  const series: number[] = [];
  for (const d of days) series.push((series.at(-1) ?? 0) + (d.closedTradeCount > 0 ? d.combinedPercent : 0));
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series, 0.0001);
  const range = max - min || 1;
  const x = (i: number) => (series.length <= 1 ? W / 2 : (i * W) / (series.length - 1));
  const y = (v: number) => 20 + (1 - (v - min) / range) * (H - 40);
  const line = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = series.length ? series[series.length - 1] : 0;

  return (
    <section className="overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 md:px-5 md:py-4">
        <b className="text-[15px] font-semibold">Cumulative combined P&amp;L</b>
        <span className={cn("text-sm font-semibold tabular-nums", toneText(last))}>
          {last >= 0 ? "+" : ""}
          {last.toFixed(1)}%
        </span>
      </div>
      <div className="p-3 md:p-5">
        {series.length < 2 ? (
          <div className="py-8 text-center text-[13px] text-text-3">Not enough days yet.</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumulative combined P&L, ${last >= 0 ? "up" : "down"} ${Math.abs(last).toFixed(1)} percent over ${series.length} days`} className="block h-auto w-full overflow-visible">
            <defs>
              <linearGradient id="pnl-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#b6f24f" stopOpacity="0.2" />
                <stop offset="1" stopColor="#b6f24f" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[20, H / 2, H - 20].map((gy) => (
              <line key={gy} x1="0" x2={W} y1={gy} y2={gy} stroke="var(--line)" strokeWidth="1" />
            ))}
            {min < 0 ? <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line-3)" strokeDasharray="4 4" strokeWidth="1" /> : null}
            <path d={`${line} L${x(series.length - 1).toFixed(1)} ${(H - 20).toFixed(1)} L0 ${(H - 20).toFixed(1)} Z`} fill="url(#pnl-area)" />
            <path d={line} fill="none" stroke="#b6f24f" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        )}
        {series.length >= 2 ? (
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-text-3">
            <span>{days[0].date.slice(5)}</span>
            <span>{days[days.length - 1].date.slice(5)}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---- Used by the backtest address page (components/backtest/address-pnl-panel.tsx) -------------------------------------------------

export function HeadlineStat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "positive" | "negative" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-2">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", tone === "positive" && "text-positive", tone === "negative" && "text-negative")}>{value}</span>
      <span className="text-[11px] text-text-3">{hint}</span>
    </div>
  );
}

export function StreakStat({ streak }: { streak: PnlBreakdownType["streaks"]["currentStreak"] }) {
  const Icon = streak.type === "profit" ? Flame : streak.type === "loss" ? Snowflake : Minus;
  const tone = streak.type === "profit" ? "text-positive" : streak.type === "loss" ? "text-negative" : "text-text-3";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-text-2">Current streak</span>
          <span className={`inline-flex items-center gap-1 text-lg font-semibold tabular-nums ${tone}`}>
            <Icon className="size-4" />
            {streak.length}d
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{streak.type === "none" ? "No active streak" : `${streak.length}-day ${streak.type} streak`}</TooltipContent>
    </Tooltip>
  );
}

export function DailyBar({ day, negativeBalance }: { day: PnlBreakdownType["dailyBreakdown"][number]; negativeBalance?: PnlBreakdownType["negativeBalanceBreakdown"][number] }) {
  const magnitude = Math.min(100, Math.abs(day.combinedPercent));
  const isPositive = day.combinedPercent > 0;
  const isNegative = day.combinedPercent < 0;
  const wentNegative = (negativeBalance?.count ?? 0) > 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-text-3">{day.date.slice(5)}</span>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-3">
        {day.closedTradeCount > 0 && <div className={`absolute inset-y-0 left-0 rounded ${isPositive ? "bg-positive" : isNegative ? "bg-negative" : "bg-text-3/40"}`} style={{ width: `${Math.max(magnitude, 2)}%` }} />}
      </div>
      {wentNegative && negativeBalance && (
        <Tooltip>
          <TooltipTrigger asChild>
            <TriangleAlert className="size-3.5 shrink-0 text-negative" />
          </TooltipTrigger>
          <TooltipContent>
            Balance went negative {negativeBalance.count} time{negativeBalance.count === 1 ? "" : "s"} this day - deepest point {formatUsd(-Math.abs(negativeBalance.maxDepthUsd))}
          </TooltipContent>
        </Tooltip>
      )}
      <span className={cn("w-16 shrink-0 text-right tabular-nums", isPositive && "text-positive", isNegative && "text-negative", !isPositive && !isNegative && "text-text-3")}>
        {day.closedTradeCount > 0 ? `${day.combinedPercent >= 0 ? "+" : ""}${day.combinedPercent.toFixed(1)}%` : "—"}
      </span>
    </div>
  );
}
