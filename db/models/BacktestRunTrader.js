import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

/**
 * One address inside one run, with its own stage and progress counters - what
 * the per-address progress bar and "can I already see its P&L" read.
 *
 * Progress is weighted: collecting transactions is ~35%, simulating the
 * trades ~65% (see db/backtest/progress.js). `claimedBy`/`leaseUntil` is a
 * lease so a crashed worker's addresses get picked up again automatically.
 */
const BacktestRunTraderSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, required: true, index: true },
  address: { type: String, required: true },

  stage: { type: String, enum: ["pending", "collecting", "simulating", "done", "failed", "skipped"], default: "pending" },
  error: { type: String, default: null },
  // Set when the address was stopped early as a loss trader (stage "skipped", `error` says why); null for every other skip.
  stopReason: { type: String, enum: ["loss_days", "day_loss_cap", "negative_balance", "loss_at_progress", null], default: null },
  // The pump.fun user id this address was collected with (copied from the backtest list when the run was created); "" = collect over RPC.
  userId: { type: String, default: "" },

  collect: {
    done: { type: Boolean, default: false },
    source: { type: String, enum: ["api", "rpc", null], default: null }, // where the trades are being read from
    listing: { type: Boolean, default: false }, // still paging signature lists (total not known yet)
    signaturesFound: { type: Number, default: 0 }, // successful signatures inside the window
    signaturesToProcess: { type: Number, default: 0 }, // of those, not already cached from an earlier run
    signaturesProcessed: { type: Number, default: 0 },
    signaturesFailed: { type: Number, default: 0 }, // RPC errors - retried the next time this address is collected
    tradesFound: { type: Number, default: 0 }, // pump buys+sells inside the window
  },
  sim: {
    done: { type: Boolean, default: false },
    signalsTotal: { type: Number, default: 0 }, // tokens this address bought in the window
    signalsDone: { type: Number, default: 0 },
    // Everything strictly before this instant is fully simulated (positions are worked through oldest-first) - lets the UI mark which days are complete.
    simulatedThrough: { type: Date, default: null },
    skipped: {
      dust: { type: Number, default: 0 },
      noData: { type: Number, default: 0 },
      insufficientBalance: { type: Number, default: 0 },
      unresolved: { type: Number, default: 0 },
      error: { type: Number, default: 0 },
    },
  },

  // This address's results so far (see db/backtest/runStats.js). Kept here, next to the stage, so the run page can filter, sort and page the
  // addresses with a plain query instead of re-adding up every position of the run on each refresh.
  stats: {
    closed: { type: Number, default: 0 },
    open: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    winRatePercent: { type: Number, default: null },
    realizedPnlUsd: { type: Number, default: 0 },
    totalLossUsd: { type: Number, default: 0 }, // every losing trade added up, as a positive dollar amount
    combinedPercent: { type: Number, default: 0 },
    avgPercent: { type: Number, default: null },
    avgPnlUsd: { type: Number, default: null }, // realized P&L per closed trade
    bestPercent: { type: Number, default: null },
    worstPercent: { type: Number, default: null },
    unrealizedUsd: { type: Number, default: 0 },
    daily: {
      tradingDays: { type: Number, default: 0 },
      lossDays: { type: Number, default: 0 },
      profitDays: { type: Number, default: 0 },
      profitDaysPercent: { type: Number, default: null }, // profit days / trading days * 100
      avgPnlPerDayUsd: { type: Number, default: null }, // dollar P&L / trading days
      grossProfitPercent: { type: Number, default: 0 },
      grossLossPercent: { type: Number, default: 0 },
      profitMarginPercent: { type: Number, default: null },
      bestDay: { type: Schema.Types.Mixed, default: null },
      withoutBestDay: { type: Schema.Types.Mixed, default: null },
    },
  },

  claimedBy: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
});

BacktestRunTraderSchema.index({ runId: 1, address: 1 }, { unique: true });
BacktestRunTraderSchema.index({ stage: 1, leaseUntil: 1 });
// The worker's "next address to work on" (runId + stage in [...], oldest first) and the stage counts of a run - without it every claim
// walks past all the finished addresses of the run, which makes a run of many addresses slower and slower.
BacktestRunTraderSchema.index({ runId: 1, stage: 1, _id: 1 });
// "How many backtests used this address" for a page of the address list.
BacktestRunTraderSchema.index({ address: 1 });
// One index per sortable column of the run page, so sorting (either way) a backtest of hundreds of thousands of addresses walks an index
// instead of sorting every row. The tie-break is `_id` in the SAME direction as the column, which is what lets one index serve both directions.
export const SORT_INDEX_FIELDS = [
  "stats.realizedPnlUsd",
  "stats.combinedPercent",
  "stats.avgPnlUsd",
  "stats.winRatePercent",
  "stats.closed",
  "stats.daily.lossDays",
  "stats.daily.profitMarginPercent",
  "stats.daily.withoutBestDay.combinedPercent",
  "stats.daily.avgPnlPerDayUsd",
  "stats.daily.profitDaysPercent",
  "stats.totalLossUsd",
  "stats.daily.grossLossPercent",
];
for (const field of SORT_INDEX_FIELDS) BacktestRunTraderSchema.index({ runId: 1, [field]: -1, _id: -1 });

export const BacktestRunTrader = models.BacktestRunTrader || model("BacktestRunTrader", BacktestRunTraderSchema);
