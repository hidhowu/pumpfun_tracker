/** Types for the Backtest feature - see db/backtest/ and app/api/backtest/. */
import type { NegativeBalanceDayStats, WalletPnlBreakdown } from "./types";

/** One entry of the Backtest address list - separate from live Traders. */
export type BacktestAddressView = {
  _id: string;
  address: string;
  label: string;
  notes: string;
  source: "manual" | "traders" | "list" | "import";
  addedAt: string;
  // The span of this address's history already cached from earlier backtests - a new backtest only fetches what is missing outside it.
  cachedFrom: string | null;
  cachedTo: string | null;
  runCount: number;
  liveStatus: "active" | "blacklisted" | null;
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
  addressesSettled: number;
  etaMs: number | null;
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
  // An address with more signatures than this in the window is skipped (0 / missing = no limit).
  maxSignatures?: number;
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
