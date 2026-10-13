/** Types for the Backtest feature - see db/backtest/ and app/api/backtest/. */
import type { NegativeBalanceDayStats, WalletPnlBreakdown } from "./types";

/** One entry of the Backtest address list - separate from live Traders. */
export type BacktestAddressView = {
  _id: string;
  address: string;
  label: string;
  notes: string;
  // pump.fun user id - with it the address's trades are read from pump.fun directly (fast); without it, over RPC (slow).
  userId?: string;
  source: "manual" | "traders" | "list" | "import";
  addedAt: string;
  // The span of this address's history already cached from earlier backtests - a new backtest only fetches what is missing outside it.
  cachedFrom: string | null;
  cachedTo: string | null;
  runCount: number;
  liveStatus: "active" | "blacklisted" | null;
};

/** Day-by-day quality of one trader (a day = a UTC day with at least one closed trade; percents are the combined % of that day). See db/backtest/dayStats.js. */
export type BacktestDaySummary = {
  tradingDays: number;
  lossDays: number;
  profitDays: number;
  grossProfitPercent: number;
  grossLossPercent: number;
  /** (profit - loss) / profit * 100 over the days: how much of the profit is left after the losing days. null = no profitable day. */
  profitMarginPercent: number | null;
  bestDay: { date: string; pnlUsd: number; percent: number } | null;
  /** The same trader with its best day removed. null = no day yet. */
  withoutBestDay: { combinedPercent: number; pnlUsd: number; lossDays: number; profitMarginPercent: number | null; stillProfitable: boolean } | null;
};

export type BacktestStats = {
  closed: number;
  open: number;
  skipped: number;
  wins: number;
  losses: number;
  winRatePercent: number | null;
  realizedPnlUsd: number;
  combinedPercent: number;
  avgPercent: number | null;
  bestPercent: number | null;
  worstPercent: number | null;
  unrealizedUsd: number;
  // Only on a run's addresses (not the run-level totals).
  daily?: BacktestDaySummary;
};

/** The profile settings a backtest follows, frozen when it was created. */
export type BacktestStrategy = {
  allocationUsd: number;
  tradeSizeUsd: number;
  dustBuyUsd: number;
  dustSellFractionPercent: number;
  stopLossPercent: number | null;
  takeProfitPercent: number | null;
  maxTradeTimeSeconds: number;
  trailingStops: Array<{ _id: string; armPercent: number; exitPercent: number }>;
  allowNegativeBalance: boolean;
  executionDelaySeconds: number;
  // Absent on backtests made before these existed: they looked at every pool trade with no extra reaction time.
  riskCheckIntervalSeconds?: number;
  fillLatencySeconds?: number;
  pumpFeePercent: number;
  jitoFeeUsd: number;
};

export type BacktestStatus = "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";

export type BacktestRunProgress = {
  percent: number;
  addressesTotal: number;
  addressesDone: number;
  addressesFailed: number;
  addressesSkipped: number;
  addressesStoppedEarly?: number; // part of addressesSkipped: dropped as loss traders
  addressesSettled: number;
  etaMs: number | null;
};

/** The shared wallet of a combined backtest (every address trades as one wallet). The trade amount and the fees are in the run's `settings`. */
export type BacktestCombinedConfig = {
  startingBalanceUsd: number;
  /** Every UTC day starts again from the starting balance; a trade belongs to the day it was entered. */
  resetDaily: boolean;
  /** false = a buy the balance cannot pay is not taken. */
  allowNegativeBalance: boolean;
};

export type BacktestRunDefinition = {
  _id: string;
  name: string;
  days: number;
  windowStart: string;
  windowEnd: string;
  profileId: string | null;
  profileName: string;
  settings: BacktestStrategy;
  addresses: string[];
  // Missing on backtests made before combined backtests existed: those are "separate".
  mode?: "separate" | "combined";
  combined?: BacktestCombinedConfig | null;
  // An address with more signatures than this in the window is skipped (0 / missing = no limit).
  maxSignatures?: number;
  // Loss-trader rules (0 = off) and how many addresses of this backtest run at once (null / missing = automatic). Runs made before these existed have neither.
  earlyStop?: { lossDays: number; dayLossPercent: number; negativeBalanceEvents?: number; lossAtProgressPercent: number };
  addressParallelism?: number | null;
  // Days of one address worked at once (0 / missing = no limit).
  daysAtOnce?: number;
  status: BacktestStatus;
  control: "run" | "pause" | "cancel";
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  activeMs: number;
};

export type BacktestRunSummary = BacktestRunDefinition & {
  progress: BacktestRunProgress;
  stats: BacktestStats;
};

export type BacktestStage = "pending" | "collecting" | "simulating" | "done" | "failed" | "skipped";

export type BacktestRunTraderView = {
  address: string;
  label: string;
  stage: BacktestStage;
  error: string | null;
  progressPercent: number;
  collect: {
    done: boolean;
    source?: "api" | "rpc" | null;
    listing: boolean;
    signaturesFound: number;
    signaturesToProcess: number;
    signaturesProcessed: number;
    signaturesFailed: number;
    tradesFound: number;
  };
  sim: {
    done: boolean;
    signalsTotal: number;
    signalsDone: number;
    simulatedThrough: string | null;
    skipped: { dust: number; noData: number; insufficientBalance: number; unresolved: number; error: number };
  };
  stats: BacktestStats;
};

export type BacktestRunDetail = {
  run: BacktestRunDefinition;
  progress: BacktestRunProgress;
  stats: BacktestStats;
  traders: BacktestRunTraderView[];
};

export type BacktestCloseReason = "trader_sell" | "stop_loss" | "take_profit" | "trailing_stop" | "max_hold_time";

export type BacktestPositionView = {
  _id: string;
  address: string;
  mint: string;
  status: "closed" | "open" | "skipped";
  skipReason: string | null;
  signalTime: number;
  traderBuySignature: string | null;
  traderBuyTime: number | null;
  traderBuySol: number | null;
  traderBuyUsd: number | null;
  traderSellSignature: string | null;
  traderSellTime: number | null;
  openedAt: string | null;
  buyPriceUsd: number | null;
  buyPriceSource: "trade" | "prior_trade" | null;
  tokenAmount: number | null;
  costBasisUsd: number | null;
  buyFeeUsd: number | null;
  closedAt: string | null;
  closeSignalAt: string | null;
  closeReason: BacktestCloseReason | null;
  sellPriceUsd: number | null;
  proceedsUsd: number | null;
  sellFeeUsd: number | null;
  realizedPnlUsd: number | null;
  realizedPnlPercent: number | null;
  markPriceUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPercent: number | null;
  maxUnrealizedPnlPercent: number | null;
  minUnrealizedPnlPercent: number | null;
  tradesScanned: number;
};

export type BacktestDay = { pnlUsd: number; combinedPercent: number; trades: number; wins: number; losses: number };

export type BacktestDaily = {
  days: string[];
  byAddress: Record<string, Record<string, BacktestDay>>;
  // Per address: null = fully simulated, "" = nothing yet, "YYYY-MM-DD" = days strictly before it are complete.
  through: Record<string, string | null>;
};

export type BacktestEquityPoint = { t: string; cumulativeUsd: number; n: number };

export type BacktestEffectiveSettings = {
  addressParallelism: number;
  txParallelismPerAddress: number;
  positionParallelism: number;
  rpcRpsPerEndpoint: number;
  sharedRpcFraction: number;
  proxyRps: number;
  userTradesRps: number;
  fillLatencySeconds: number;
  directRps: number;
  minSolAmount: number;
  program: string;
  initialWindowSeconds: number;
  maxPagesPerPosition: number;
};

export type BacktestStoredSettings = {
  // null = auto (derived from the number of proxies/RPCs)
  addressParallelism: number | null;
  txParallelismPerAddress: number | null;
  positionParallelism: number | null;
  rpcRpsPerEndpoint: number | null;
  proxyRps: number | null;
  sharedRpcFraction: number;
  userTradesRps: number;
  fillLatencySeconds: number;
  directRps: number;
  minSolAmount: number;
  program: string;
  initialWindowSeconds: number;
  maxPagesPerPosition: number;
};

export type BacktestSettingsView = {
  stored: BacktestStoredSettings;
  effective: BacktestEffectiveSettings;
  worker: { heartbeatAt: string | null; id: string | null };
  capacity: { proxies: number; rpcDedicated: number; rpcShared: number; pumpCapacityRps: number; rpcCapacityRps: number };
};

/** One address of a run, as the address page shows it: the run it belongs to, its progress, and its simulated wallet. */
export type BacktestAddressDetail = {
  run: Pick<BacktestRunDefinition, "_id" | "name" | "days" | "windowStart" | "windowEnd" | "profileName" | "settings" | "status" | "control">;
  trader: BacktestRunTraderView;
  notes: string;
  wallet: {
    startingUsd: number;
    balanceUsd: number; // uncommitted cash
    walletValueUsd: number; // cash + open trades marked at the end of the window
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    openPositionCount: number;
    closedPositionCount: number;
    negativeBalanceEventCount: number;
    maxNegativeBalanceUsd: number;
  };
};

export type BacktestPnlPeriod = "day" | "week" | "month" | "all";

/** The live wallet P&L shape (so the same chart draws it) plus what only a backtest knows. */
export type BacktestAddressPnl = Omit<WalletPnlBreakdown, "period"> & {
  period: BacktestPnlPeriod;
  averageTradesPerDay: number;
  negativeBalanceBreakdown: NegativeBalanceDayStats[];
  range: { from: string; to: string };
  // null = fully simulated, "" = nothing yet, "YYYY-MM-DD" = days strictly before it are complete.
  through: string | null;
};

/** One UTC day of the combined wallet. In a reset-daily backtest the day is the day the trades were entered, otherwise the day they closed. */
export type BacktestCombinedDay = {
  date: string;
  startBalanceUsd: number;
  endBalanceUsd: number;
  lowestBalanceUsd: number;
  pnlUsd: number;
  trades: number;
  wins: number;
  losses: number;
  negativeEvents: number;
  maxNegativeDepthUsd: number;
  /** Buys skipped because the balance could not pay them (only when a negative balance is not allowed). */
  notTaken: number;
};

export type BacktestCombinedWallet = {
  config: BacktestCombinedConfig & { tradeAmountUsd: number; pumpFeePercent: number; jitoFeeUsd: number };
  wallet: {
    startingUsd: number;
    balanceUsd: number; // uncommitted cash at the end (reset daily: where the last day ended)
    walletValueUsd: number | null; // cash + open trades marked at the end of the window; null when the balance resets daily
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    openPositionCount: number;
    closedPositionCount: number;
    wins: number;
    losses: number;
    winRatePercent: number | null;
    negativeBalanceEventCount: number;
    maxNegativeBalanceUsd: number;
    lowestBalanceUsd: number;
    notTakenCount: number;
    lossDays: number;
    profitDays: number;
    negativeDays: number;
  };
  days: BacktestCombinedDay[];
  /** Balance after every buy and sell (empty when the balance resets daily). */
  curve: Array<{ t: number; balanceUsd: number }>;
  /** false while addresses are still being worked on: the figures then cover only the trades simulated so far. */
  complete: boolean;
};
