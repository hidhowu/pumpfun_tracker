import { Wallet } from "./models/Wallet.js";
import { WalletTrader } from "./models/WalletTrader.js";
import { WalletPosition } from "./models/WalletPosition.js";
import { Profile } from "./models/Profile.js";
import { Trader } from "./models/Trader.js";
import { SimPosition } from "./models/SimPosition.js";

/**
 * CSV performance exports for one Wallet or one Profile - per-trader
 * hourly/daily (or per-trade) breakdowns over a date range, for analysis in
 * a spreadsheet.
 *
 * P&L is REALIZED and per closed trade (both fees included - realizedPnlUsd
 * on the position), bucketed by when the trade CLOSED - the same convention
 * every P&L chart in the app uses. "Buys opened" is bucketed by when the
 * position opened. Timestamps are shifted by `tzOffsetMinutes` (minutes east
 * of UTC, e.g. 60 for UTC+1) so hours/days line up with the viewer's clock.
 */

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------- formatting

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

const usd = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "" : n.toFixed(2));
const pct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "" : n.toFixed(2));

export function makeClock(tzOffsetMinutes) {
  const offsetMs = tzOffsetMinutes * 60000;
  const shift = (date) => new Date(new Date(date).getTime() + offsetMs);
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return {
    /** "YYYY-MM-DD HH:mm" in the export's timezone */
    stamp(date) {
      if (!date) return "";
      const d = shift(date);
      return `${ymd(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    },
    /** Start (real UTC instant) of the hour/day bucket containing `date`, in the export's timezone. */
    bucketStart(date, granularity) {
      const local = shift(date).getTime();
      const size = granularity === "hour" ? HOUR_MS : DAY_MS;
      return new Date(Math.floor(local / size) * size - offsetMs);
    },
    label(bucketStartDate, granularity) {
      const d = shift(bucketStartDate);
      return granularity === "hour" ? `${ymd(d)} ${pad(d.getUTCHours())}:00` : ymd(d);
    },
    /** Real UTC instant of local midnight at the start of a "YYYY-MM-DD" date in the export's timezone. */
    dayStartFromDateString(dateStr) {
      return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - offsetMs);
    },
    tzLabel() {
      if (tzOffsetMinutes === 0) return "UTC";
      const sign = tzOffsetMinutes > 0 ? "+" : "-";
      const abs = Math.abs(tzOffsetMinutes);
      return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    },
  };
}

// -------------------------------------------------------------- aggregation

function emptyBucket() {
  return {
    opened: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    pnlUsd: 0,
    investedUsd: 0, // cost basis + buy fee of the trades closed in this bucket
    sumReturnPercent: 0,
    feesUsd: 0,
    bestUsd: null,
    worstUsd: null,
  };
}

function addClosed(bucket, p) {
  const pnl = p.realizedPnlUsd || 0;
  bucket.closed += 1;
  if (pnl > 0) bucket.wins += 1;
  else if (pnl < 0) bucket.losses += 1;
  bucket.pnlUsd += pnl;
  bucket.investedUsd += (p.costBasisUsd || 0) + (p.buyFeeUsd || 0);
  bucket.sumReturnPercent += p.realizedPnlPercent || 0;
  bucket.feesUsd += (p.buyFeeUsd || 0) + (p.sellFeeUsd || 0);
  bucket.bestUsd = bucket.bestUsd === null ? pnl : Math.max(bucket.bestUsd, pnl);
  bucket.worstUsd = bucket.worstUsd === null ? pnl : Math.min(bucket.worstUsd, pnl);
}

function bucketMetrics(b) {
  const decided = b.wins + b.losses;
  return {
    winRate: decided > 0 ? (b.wins / decided) * 100 : null,
    returnPercent: b.investedUsd > 0 ? (b.pnlUsd / b.investedUsd) * 100 : null,
    avgPnl: b.closed > 0 ? b.pnlUsd / b.closed : null,
    result: b.closed === 0 ? "No trades" : b.pnlUsd > 0 ? "Profit" : b.pnlUsd < 0 ? "Loss" : "Flat",
  };
}

/** Groups positions into hour/day buckets keyed by bucket-start epoch ms. */
function bucketize(positions, granularity, clock, rangeStart, rangeEnd) {
  const buckets = new Map();
  const get = (date) => {
    const key = clock.bucketStart(date, granularity).getTime();
    if (!buckets.has(key)) buckets.set(key, emptyBucket());
    return buckets.get(key);
  };
  for (const p of positions) {
    if (p.openedAt >= rangeStart && p.openedAt < rangeEnd) get(p.openedAt).opened += 1;
    if (p.status === "closed" && p.closedAt && p.closedAt >= rangeStart && p.closedAt < rangeEnd) addClosed(get(p.closedAt), p);
  }
  return buckets;
}

function longestStreak(dayBuckets, predicate) {
  let best = 0;
  let run = 0;
  for (const [, b] of [...dayBuckets].sort((a, z) => a[0] - z[0])) {
    if (b.closed === 0) continue; // a day with no trades doesn't break or extend a streak
    run = predicate(b) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function summarize(trader, positions, clock, rangeStart, rangeEnd) {
  const start = new Date(Math.max(rangeStart.getTime(), new Date(trader.since).getTime()));
  const spanMs = Math.max(0, rangeEnd.getTime() - start.getTime());
  const days = spanMs / DAY_MS;
  const hours = spanMs / HOUR_MS;

  const total = emptyBucket();
  for (const p of positions) {
    if (p.openedAt >= rangeStart && p.openedAt < rangeEnd) total.opened += 1;
    if (p.status === "closed" && p.closedAt && p.closedAt >= rangeStart && p.closedAt < rangeEnd) addClosed(total, p);
  }
  const openNow = positions.filter((p) => p.status === "open").length;

  const dayBuckets = bucketize(positions, "day", clock, rangeStart, rangeEnd);
  const hourBuckets = bucketize(positions, "hour", clock, rangeStart, rangeEnd);
  const tradedDays = [...dayBuckets].filter(([, b]) => b.closed > 0);
  const tradedHours = [...hourBuckets].filter(([, b]) => b.closed > 0);
  const best = tradedDays.reduce((acc, d) => (!acc || d[1].pnlUsd > acc[1].pnlUsd ? d : acc), null);
  const worst = tradedDays.reduce((acc, d) => (!acc || d[1].pnlUsd < acc[1].pnlUsd ? d : acc), null);

  const closedInRange = positions.filter((p) => p.status === "closed" && p.closedAt >= rangeStart && p.closedAt < rangeEnd);
  const firstTrade = positions.reduce((min, p) => (!min || p.openedAt < min ? p.openedAt : min), null);
  const lastTrade = positions.reduce((max, p) => {
    const t = p.closedAt && p.closedAt > p.openedAt ? p.closedAt : p.openedAt;
    return !max || t > max ? t : max;
  }, null);
  const avgHoldMinutes =
    closedInRange.length > 0
      ? closedInRange.reduce((sum, p) => sum + (p.closedAt - p.openedAt), 0) / closedInRange.length / 60000
      : null;

  const m = bucketMetrics(total);
  return {
    total,
    m,
    openNow,
    days,
    hours,
    avgHoldMinutes,
    firstTrade,
    lastTrade,
    activeDays: tradedDays.length,
    winDays: tradedDays.filter(([, b]) => b.pnlUsd > 0).length,
    lossDays: tradedDays.filter(([, b]) => b.pnlUsd < 0).length,
    flatDays: tradedDays.filter(([, b]) => b.pnlUsd === 0).length,
    winHours: tradedHours.filter(([, b]) => b.pnlUsd > 0).length,
    lossHours: tradedHours.filter(([, b]) => b.pnlUsd < 0).length,
    best,
    worst,
    longestWinDays: longestStreak(dayBuckets, (b) => b.pnlUsd > 0),
    longestLossDays: longestStreak(dayBuckets, (b) => b.pnlUsd < 0),
  };
}

// ----------------------------------------------------------------- sections

const SUMMARY_HEADER = [
  "Trader",
  "Label",
  "Status",
  "Tracked since",
  "First trade",
  "Last trade",
  "Days covered",
  "Buys opened",
  "Trades closed",
  "Open now",
  "Wins",
  "Losses",
  "Win rate %",
  "Realized P&L $",
  "Invested $",
  "Return %",
  "Sum of trade returns %",
  "Fees paid $",
  "Avg P&L per trade $",
  "Avg hold (min)",
  "Avg trades per day",
  "Avg trades per hour",
  "Avg P&L per day $",
  "Active days",
  "Win days",
  "Loss days",
  "Flat days",
  "Win hours",
  "Loss hours",
  "Best day",
  "Best day P&L $",
  "Worst day",
  "Worst day P&L $",
  "Longest win streak (days)",
  "Longest loss streak (days)",
];

function summaryRow(trader, s, clock) {
  const t = s.total;
  return [
    trader.address,
    trader.label,
    trader.status,
    clock.stamp(trader.since),
    clock.stamp(s.firstTrade),
    clock.stamp(s.lastTrade),
    s.days.toFixed(1),
    t.opened,
    t.closed,
    s.openNow,
    t.wins,
    t.losses,
    pct(s.m.winRate),
    usd(t.pnlUsd),
    usd(t.investedUsd),
    pct(s.m.returnPercent),
    pct(t.sumReturnPercent),
    usd(t.feesUsd),
    usd(s.m.avgPnl),
    s.avgHoldMinutes === null ? "" : s.avgHoldMinutes.toFixed(1),
    s.days > 0 ? (t.closed / s.days).toFixed(2) : "",
    s.hours > 0 ? (t.closed / s.hours).toFixed(3) : "",
    s.days > 0 ? usd(t.pnlUsd / s.days) : "",
    s.activeDays,
    s.winDays,
    s.lossDays,
    s.flatDays,
    s.winHours,
    s.lossHours,
    s.best ? clock.label(new Date(s.best[0]), "day") : "",
    s.best ? usd(s.best[1].pnlUsd) : "",
    s.worst ? clock.label(new Date(s.worst[0]), "day") : "",
    s.worst ? usd(s.worst[1].pnlUsd) : "",
    s.longestWinDays,
    s.longestLossDays,
  ];
}

const PERIOD_HEADER = [
  "Period start",
  "Period end",
  "Buys opened",
  "Trades closed",
  "Wins",
  "Losses",
  "Win rate %",
  "Realized P&L $",
  "Invested $",
  "Return %",
  "Sum of trade returns %",
  "Avg P&L per trade $",
  "Best trade $",
  "Worst trade $",
  "Fees paid $",
  "Result",
];

function periodRows(trader, positions, granularity, clock, rangeStart, rangeEnd, includeEmpty) {
  const buckets = bucketize(positions, granularity, clock, rangeStart, rangeEnd);
  if (includeEmpty) {
    const size = granularity === "hour" ? HOUR_MS : DAY_MS;
    const first = clock.bucketStart(new Date(Math.max(rangeStart.getTime(), new Date(trader.since).getTime())), granularity);
    for (let t = first.getTime(); t < rangeEnd.getTime(); t += size) {
      if (!buckets.has(t)) buckets.set(t, emptyBucket());
    }
  }
  const size = granularity === "hour" ? HOUR_MS : DAY_MS;
  return [...buckets]
    .sort((a, z) => a[0] - z[0])
    .map(([startMs, b]) => {
      const m = bucketMetrics(b);
      return [
        clock.stamp(new Date(startMs)),
        clock.stamp(new Date(startMs + size)),
        b.opened,
        b.closed,
        b.wins,
        b.losses,
        pct(m.winRate),
        usd(b.pnlUsd),
        usd(b.investedUsd),
        pct(m.returnPercent),
        pct(b.sumReturnPercent),
        usd(m.avgPnl),
        usd(b.bestUsd),
        usd(b.worstUsd),
        usd(b.feesUsd),
        m.result,
      ];
    });
}

const TRADE_HEADER = [
  "Mint",
  "Status",
  "Opened",
  "Closed",
  "Hold (min)",
  "Buy price $",
  "Sell price $",
  "Cost $",
  "Buy fee $",
  "Buy pump fee $",
  "Buy jito fee $",
  "Proceeds $",
  "Sell fee $",
  "Sell pump fee $",
  "Sell jito fee $",
  "Realized P&L $",
  "Realized P&L %",
  "Peak %",
  "Lowest %",
  "Close reason",
];

function tradeRows(positions, clock, rangeStart, rangeEnd) {
  return positions
    .filter((p) => (p.openedAt >= rangeStart && p.openedAt < rangeEnd) || (p.closedAt && p.closedAt >= rangeStart && p.closedAt < rangeEnd))
    .sort((a, z) => a.openedAt - z.openedAt)
    .map((p) => [
      p.mint,
      p.status,
      clock.stamp(p.openedAt),
      clock.stamp(p.closedAt),
      p.closedAt ? ((p.closedAt - p.openedAt) / 60000).toFixed(1) : "",
      p.buyPriceUsd,
      p.sellPriceUsd ?? "",
      usd(p.costBasisUsd),
      usd(p.buyFeeUsd),
      usd(p.buyPumpFeeUsd),
      usd(p.buyJitoFeeUsd),
      usd(p.proceedsUsd),
      usd(p.sellFeeUsd),
      usd(p.sellPumpFeeUsd),
      usd(p.sellJitoFeeUsd),
      usd(p.realizedPnlUsd),
      pct(p.realizedPnlPercent),
      pct(p.maxUnrealizedPnlPercent),
      pct(p.minUnrealizedPnlPercent),
      p.closeReason ?? "",
    ]);
}

// -------------------------------------------------------------- the report

/**
 * @param {object} args
 * @param {string} args.scopeLabel  e.g. 'Wallet "Main"'
 * @param {Array<{address, label, status, since}>} args.traders
 * @param {Array} args.positions    lean WalletPosition/SimPosition docs, any trader in `traders`
 * @param {"hour"|"day"|"trade"} args.granularity
 * @param {"sections"|"flat"} args.layout
 */
export function buildCsv({ scopeLabel, traders, positions, granularity, layout, rangeStart, rangeEnd, rangeLabel, clock, includeEmpty }) {
  const byTrader = new Map(traders.map((t) => [t.address, []]));
  for (const p of positions) byTrader.get(p.traderAddress)?.push(p);

  const lines = [];
  const granularityLabel = { hour: "Hourly", day: "Daily", trade: "Individual trades" }[granularity];

  if (layout === "flat") {
    // One plain table - every row self-describing - for pivot tables/filters.
    const header = granularity === "trade" ? TRADE_HEADER : PERIOD_HEADER;
    lines.push(csvRow(["Trader", "Label", ...header]));
    for (const trader of traders) {
      const rows =
        granularity === "trade"
          ? tradeRows(byTrader.get(trader.address), clock, rangeStart, rangeEnd)
          : periodRows(trader, byTrader.get(trader.address), granularity, clock, rangeStart, rangeEnd, includeEmpty);
      for (const row of rows) lines.push(csvRow([trader.address, trader.label, ...row]));
    }
    return lines.join("\r\n");
  }

  lines.push(csvRow(["Report", `${scopeLabel} - trader performance`]));
  lines.push(csvRow(["Range", rangeLabel]));
  lines.push(csvRow(["Timezone", clock.tzLabel()]));
  lines.push(csvRow(["Breakdown", granularityLabel]));
  lines.push(csvRow(["Generated", clock.stamp(new Date())]));
  lines.push(csvRow(["Note", "P&L is realized per closed trade, after buy and sell fees, counted when the trade closed."]));
  lines.push("");

  // Summary: one row per trader, plus an all-traders total.
  lines.push(csvRow(["SUMMARY"]));
  lines.push(csvRow(SUMMARY_HEADER));
  const all = { address: "ALL TRADERS", label: `${traders.length} traders`, status: "", since: traders.reduce((min, t) => (!min || t.since < min ? t.since : min), null) ?? rangeStart };
  for (const trader of traders) {
    lines.push(csvRow(summaryRow(trader, summarize(trader, byTrader.get(trader.address), clock, rangeStart, rangeEnd), clock)));
  }
  lines.push(csvRow(summaryRow(all, summarize(all, positions, clock, rangeStart, rangeEnd), clock)));
  lines.push("");

  // One section per trader.
  for (const trader of traders) {
    lines.push(csvRow([`TRADER: ${trader.label ? `${trader.label} (${trader.address})` : trader.address}`]));
    if (granularity === "trade") {
      lines.push(csvRow(TRADE_HEADER));
      for (const row of tradeRows(byTrader.get(trader.address), clock, rangeStart, rangeEnd)) lines.push(csvRow(row));
    } else {
      lines.push(csvRow(PERIOD_HEADER));
      const rows = periodRows(trader, byTrader.get(trader.address), granularity, clock, rangeStart, rangeEnd, includeEmpty);
      if (rows.length === 0) lines.push(csvRow(["(no trades in this range)"]));
      for (const row of rows) lines.push(csvRow(row));
    }
    lines.push("");
  }

  return lines.join("\r\n");
}

/** Validates/normalizes the query options shared by both export endpoints. */
export function parseExportOptions(searchParams) {
  const granularity = ["hour", "day", "trade"].includes(searchParams.get("granularity")) ? searchParams.get("granularity") : "day";
  const layout = searchParams.get("layout") === "flat" ? "flat" : "sections";
  const tz = Number(searchParams.get("tz") || 0);
  const tzOffsetMinutes = Number.isFinite(tz) ? Math.max(-14 * 60, Math.min(14 * 60, Math.round(tz))) : 0;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const from = dateRe.test(searchParams.get("from") || "") ? searchParams.get("from") : null;
  const to = dateRe.test(searchParams.get("to") || "") ? searchParams.get("to") : null;
  const includeEmpty = searchParams.get("includeEmpty") === "1";
  return { granularity, layout, tzOffsetMinutes, from, to, includeEmpty };
}

function resolveRange(clock, { from, to }, earliest) {
  const rangeStart = from ? clock.dayStartFromDateString(from) : new Date(earliest ?? Date.now());
  // `to` is inclusive: through the end of that day. Never past "now".
  const rangeEnd = to ? new Date(Math.min(clock.dayStartFromDateString(to).getTime() + DAY_MS, Date.now())) : new Date();
  const rangeLabel = `${from ? clock.stamp(rangeStart) : `${clock.stamp(rangeStart)} (entire period)`} to ${clock.stamp(rangeEnd)}`;
  return { rangeStart, rangeEnd, rangeLabel };
}

function positionRangeFilter(rangeStart, rangeEnd) {
  return {
    $or: [
      { openedAt: { $gte: rangeStart, $lt: rangeEnd } },
      { closedAt: { $gte: rangeStart, $lt: rangeEnd } },
      { status: "open" },
    ],
  };
}

const POSITION_FIELDS = {
  traderAddress: 1,
  mint: 1,
  status: 1,
  openedAt: 1,
  closedAt: 1,
  costBasisUsd: 1,
  buyFeeUsd: 1,
  buyPumpFeeUsd: 1,
  buyJitoFeeUsd: 1,
  buyPriceUsd: 1,
  sellPriceUsd: 1,
  proceedsUsd: 1,
  sellFeeUsd: 1,
  sellPumpFeeUsd: 1,
  sellJitoFeeUsd: 1,
  realizedPnlUsd: 1,
  realizedPnlPercent: 1,
  maxUnrealizedPnlPercent: 1,
  minUnrealizedPnlPercent: 1,
  closeReason: 1,
};

/**
 * Every trader currently assigned to the wallet, scoped to trades they made
 * ON THIS WALLET only. "Entire period" starts when the earliest of them was
 * added to the wallet; each trader's own stats start from when THEY were added.
 */
export async function exportWalletCsv(walletId, options) {
  const wallet = await Wallet.findById(walletId).lean();
  if (!wallet) return null;
  const clock = makeClock(options.tzOffsetMinutes);

  const walletTraders = await WalletTrader.find({ walletId }).sort({ addedAt: 1 }).lean();
  const traderDocs = await Trader.find({ address: { $in: walletTraders.map((wt) => wt.traderAddress) } }, { address: 1, label: 1, status: 1 }).lean();
  const docByAddress = new Map(traderDocs.map((t) => [t.address, t]));
  const traders = walletTraders.map((wt) => ({
    address: wt.traderAddress,
    label: docByAddress.get(wt.traderAddress)?.label || "",
    status: docByAddress.get(wt.traderAddress)?.status || "removed",
    since: wt.addedAt,
  }));

  await includeEarlierTrades(traders, WalletPosition, { walletId });
  const earliest = traders.reduce((min, t) => (!min || t.since < min ? t.since : min), null) ?? wallet.createdAt;
  const { rangeStart, rangeEnd, rangeLabel } = resolveRange(clock, options, earliest);
  const positions = await WalletPosition.find(
    { walletId, traderAddress: { $in: traders.map((t) => t.address) }, ...positionRangeFilter(rangeStart, rangeEnd) },
    POSITION_FIELDS
  ).lean();

  const csv = buildCsv({ scopeLabel: `Wallet "${wallet.name}"`, traders, positions, rangeStart, rangeEnd, rangeLabel, clock, ...options });
  return { csv, filename: `wallet-${slug(wallet.name)}-${options.granularity}-${fileDate(rangeStart, rangeEnd, clock)}.csv` };
}

/**
 * Every ACTIVE (non-blacklisted) tracked trader, with this profile's own
 * simulated trades - each profile's numbers differ because each runs its own
 * settings. A trader's stats start from when they were added, or when the
 * profile was created if that's later.
 */
export async function exportProfileCsv(profileId, options) {
  const profile = await Profile.findById(profileId).lean();
  if (!profile) return null;
  const clock = makeClock(options.tzOffsetMinutes);

  const traderDocs = await Trader.find({ status: "active" }, { address: 1, label: 1, status: 1, addedAt: 1 }).sort({ addedAt: 1 }).lean();
  const traders = traderDocs.map((t) => ({
    address: t.address,
    label: t.label || "",
    status: t.status,
    since: new Date(Math.max(new Date(t.addedAt).getTime(), new Date(profile.createdAt).getTime())),
  }));

  await includeEarlierTrades(traders, SimPosition, { profileId });
  const earliest = traders.reduce((min, t) => (!min || t.since < min ? t.since : min), null) ?? profile.createdAt;
  const { rangeStart, rangeEnd, rangeLabel } = resolveRange(clock, options, earliest);
  const positions = await SimPosition.find(
    { profileId, traderAddress: { $in: traders.map((t) => t.address) }, ...positionRangeFilter(rangeStart, rangeEnd) },
    POSITION_FIELDS
  ).lean();

  const csv = buildCsv({ scopeLabel: `Profile "${profile.name}"`, traders, positions, rangeStart, rangeEnd, rangeLabel, clock, ...options });
  return { csv, filename: `profile-${slug(profile.name)}-${options.granularity}-${fileDate(rangeStart, rangeEnd, clock)}.csv` };
}

/**
 * Pulls each trader's `since` back to their first trade in this scope when
 * that's earlier - e.g. a trader removed from a wallet and re-added later
 * has trades from before their current addedAt, and "entire period" should
 * still include them.
 */
async function includeEarlierTrades(traders, Model, scopeFilter) {
  const firsts = await Model.aggregate([
    { $match: { ...scopeFilter, traderAddress: { $in: traders.map((t) => t.address) } } },
    { $group: { _id: "$traderAddress", first: { $min: "$openedAt" } } },
  ]);
  const firstByAddress = new Map(firsts.map((f) => [f._id, f.first]));
  for (const trader of traders) {
    const first = firstByAddress.get(trader.address);
    if (first && first < new Date(trader.since)) trader.since = first;
  }
}

function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "export"
  );
}

function fileDate(rangeStart, rangeEnd, clock) {
  return `${clock.label(rangeStart, "day")}_to_${clock.label(rangeEnd, "day")}`;
}
