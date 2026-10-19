import { BacktestAddress } from "../models/BacktestAddress.js";
import { BacktestRun } from "../models/BacktestRun.js";
import { BacktestRunTrader } from "../models/BacktestRunTrader.js";
import { BacktestPosition } from "../models/BacktestPosition.js";
import { addressSearchFilter, traderMatch, traderSort } from "./service.js";

/**
 * CSV exports, produced as a stream: rows are read from the database through a cursor a chunk at a time and handed to the browser as they
 * are made, so exporting a million addresses (or all their trades) never holds more than one chunk in memory and the download starts at once.
 */

const EXPORT_LIMIT_MS = 30 * 60_000; // an export of a huge backtest may take a while; it still must end
const ADDRESS_CHUNK = 500;
const TRADE_ADDRESS_CHUNK = 50; // addresses per round trip when their trades are included (an address can have thousands)

/** Makes a spreadsheet read a text cell as text, never as a formula (a label could be pasted from anywhere). */
const safeText = (s) => (/^[=+@\t\r-]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);

function cell(value) {
  if (value == null) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = safeText(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const line = (values) => values.map(cell).join(",") + "\r\n";

const SUMMARY_COLUMNS = [
  "address",
  "label",
  "status",
  "note",
  "closed_trades",
  "open_trades",
  "wins",
  "losses",
  "win_rate_percent",
  "realized_pnl_usd",
  "total_loss_on_trades_usd",
  "total_loss_on_days_percent",
  "avg_pnl_per_trade_usd",
  "avg_pnl_per_day_usd",
  "combined_percent",
  "avg_percent_per_trade",
  "best_trade_percent",
  "worst_trade_percent",
  "unrealized_pnl_usd",
  "trading_days",
  "loss_days",
  "profit_days",
  "profit_days_percent",
  "profit_margin_percent",
  "best_day",
  "best_day_pnl_usd",
  "without_best_day_percent",
  "still_profitable_without_best_day",
];

const summaryRow = (rt, label) => {
  const s = rt.stats ?? {};
  const d = s.daily ?? {};
  return [
    rt.address,
    label,
    rt.stage,
    rt.error ?? "",
    s.closed ?? 0,
    s.open ?? 0,
    s.wins ?? 0,
    s.losses ?? 0,
    s.winRatePercent,
    s.realizedPnlUsd ?? 0,
    -(s.totalLossUsd ?? 0), // every losing trade added up, negative like the table shows it
    -(d.grossLossPercent ?? 0), // the losing days added up, negative like the table shows it
    s.avgPnlUsd,
    d.avgPnlPerDayUsd,
    s.combinedPercent ?? 0,
    s.avgPercent,
    s.bestPercent,
    s.worstPercent,
    s.unrealizedUsd ?? 0,
    d.tradingDays ?? 0,
    d.lossDays ?? 0,
    d.profitDays ?? 0,
    d.profitDaysPercent,
    d.profitMarginPercent,
    d.bestDay?.date,
    d.bestDay?.pnlUsd,
    d.withoutBestDay?.combinedPercent,
    d.withoutBestDay?.stillProfitable,
  ];
};

const TRADE_COLUMNS = [
  "address",
  "label",
  "mint",
  "status",
  "skip_reason",
  "signal_time",
  "trader_buy_time",
  "trader_buy_sol",
  "trader_buy_usd",
  "trader_sell_time",
  "opened_at",
  "buy_price_usd",
  "token_amount",
  "cost_basis_usd",
  "buy_fee_usd",
  "closed_at",
  "close_reason",
  "sell_price_usd",
  "proceeds_usd",
  "sell_fee_usd",
  "realized_pnl_usd",
  "realized_pnl_percent",
  "mark_price_usd",
  "unrealized_pnl_usd",
  "unrealized_pnl_percent",
  "max_unrealized_pnl_percent",
  "min_unrealized_pnl_percent",
  "trader_buy_signature",
  "trader_sell_signature",
];
const unixToIso = (sec) => (typeof sec === "number" ? new Date(sec * 1000) : null);
const tradeRow = (p, label) => [
  p.address,
  label,
  p.mint,
  p.status,
  p.skipReason,
  unixToIso(p.signalTime),
  unixToIso(p.traderBuyTime),
  p.traderBuySol,
  p.traderBuyUsd,
  unixToIso(p.traderSellTime),
  p.openedAt,
  p.buyPriceUsd,
  p.tokenAmount,
  p.costBasisUsd,
  p.buyFeeUsd,
  p.closedAt,
  p.closeReason,
  p.sellPriceUsd,
  p.proceedsUsd,
  p.sellFeeUsd,
  p.realizedPnlUsd,
  p.realizedPnlPercent,
  p.markPriceUsd,
  p.unrealizedPnlUsd,
  p.unrealizedPnlPercent,
  p.maxUnrealizedPnlPercent,
  p.minUnrealizedPnlPercent,
  p.traderBuySignature,
  p.traderSellSignature,
];

async function labelsFor(addresses) {
  const rows = await BacktestAddress.find({ address: { $in: addresses } }, { address: 1, label: 1 }).lean();
  return new Map(rows.map((r) => [r.address, r.label || ""]));
}

/**
 * The addresses of a backtest that match the run page's filter, status buttons, limits and search, in the page's sort order, as CSV.
 *   mode "addresses": one column, the address - ready to paste back into a list;
 *   mode "summary":   one row per address with its label, status and all its figures;
 *   mode "trades":    one row per trade of each address (closed and open; with \`includeSkipped\` the skipped signals too).
 * @param {string} runId
 * @param {{mode?: "addresses"|"summary"|"trades", filter?: string, sort?: string, dir?: string, limits?: object, search?: string, includeSkipped?: boolean}} [opts]
 * @returns {AsyncGenerator<string>}
 */
export async function* runExportCsv(runId, { mode = "addresses", filter, sort, dir, limits, search, includeSkipped = false } = {}) {
  const run = await BacktestRun.findById(runId, { addresses: 0 }).lean();
  if (!run) throw new Error("Backtest not found");
  const match = traderMatch(run._id, { filter, limits, search });
  const chunkSize = mode === "trades" ? TRADE_ADDRESS_CHUNK : ADDRESS_CHUNK;

  yield "﻿"; // lets Excel read the labels as UTF-8
  yield line(mode === "addresses" ? ["address"] : mode === "summary" ? SUMMARY_COLUMNS : TRADE_COLUMNS);

  const cursor = BacktestRunTrader.find(match, mode === "addresses" ? { address: 1 } : mode === "summary" ? { address: 1, stage: 1, error: 1, stats: 1 } : { address: 1 })
    .sort(traderSort(sort, dir))
    .allowDiskUse(true)
    .maxTimeMS(EXPORT_LIMIT_MS)
    .lean()
    .cursor({ batchSize: chunkSize });

  let chunk = [];
  async function* flush() {
    if (chunk.length === 0) return;
    const rows = chunk;
    chunk = [];
    if (mode === "addresses") {
      yield rows.map((r) => line([r.address])).join("");
      return;
    }
    const labels = await labelsFor(rows.map((r) => r.address));
    if (mode === "summary") {
      yield rows.map((r) => line(summaryRow(r, labels.get(r.address) ?? ""))).join("");
      return;
    }
    // trades: this chunk's positions in one query, then handed out address by address in the page's order
    const byAddress = new Map(rows.map((r) => [r.address, []]));
    const positions = BacktestPosition.find(
      { runId: run._id, address: { $in: rows.map((r) => r.address) }, ...(includeSkipped ? {} : { status: { $in: ["closed", "open"] } }) },
      { _id: 0, runId: 0, createdAt: 0, __v: 0 }
    )
      .sort({ address: 1, signalTime: 1 })
      .maxTimeMS(EXPORT_LIMIT_MS)
      .lean()
      .cursor({ batchSize: 2000 });
    for await (const p of positions) byAddress.get(p.address)?.push(p);
    let out = "";
    for (const r of rows) for (const p of byAddress.get(r.address) ?? []) out += line(tradeRow(p, labels.get(r.address) ?? ""));
    if (out) yield out;
  }

  try {
    for await (const rt of cursor) {
      chunk.push(rt);
      if (chunk.length >= chunkSize) yield* flush();
    }
    yield* flush();
  } finally {
    await cursor.close().catch(() => {});
  }
}

/**
 * The backtest list (optionally only what matches the search) as CSV: "addresses" is just the address column; "full" adds the label, the pump.fun
 * user id, where it came from and when it was added.
 * @param {{search?: string, mode?: "addresses"|"full"}} [opts]
 * @returns {AsyncGenerator<string>}
 */
export async function* addressListCsv({ search = "", mode = "addresses" } = {}) {
  yield "﻿";
  yield line(mode === "full" ? ["address", "label", "pump_user_id", "source", "added_at", "notes"] : ["address"]);
  const cursor = BacktestAddress.find(addressSearchFilter(search), mode === "full" ? {} : { address: 1 })
    .sort({ addedAt: -1, _id: -1 })
    .maxTimeMS(EXPORT_LIMIT_MS)
    .lean()
    .cursor({ batchSize: 2000 });
  let out = "";
  let n = 0;
  try {
    for await (const a of cursor) {
      out += line(mode === "full" ? [a.address, a.label, a.userId, a.source, a.addedAt, a.notes] : [a.address]);
      if (++n % 2000 === 0) {
        yield out;
        out = "";
      }
    }
    if (out) yield out;
  } finally {
    await cursor.close().catch(() => {});
  }
}
