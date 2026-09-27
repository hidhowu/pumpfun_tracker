export type TraderStats = {
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  totalSolVolume: number;
  realizedPnlSol: number;
  wins: number;
  losses: number;
  lastTradeAt: string | null;
};

export type SimStats = {
  initialized: boolean;
  startingAllocationUsd: number;
  balanceUsd: number;
  everBoughtMints: string[];
  negativeBalanceEventCount: number;
  maxNegativeBalanceUsd: number;
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnlUsd: number;
  lastActionAt: string | null; // when the sim wallet last opened/closed a position - NOT the tracked wallet's own on-chain activity
};

// Per-trader simulation setting overrides - null means "inherit the global default".
export type TraderSimSettings = {
  allocationUsd: number | null;
  tradeSizeUsd: number | null;
  dustBuyUsd: number | null;
  dustSellFractionPercent: number | null;
  stopLossPercent: number | null;
  takeProfitPercent: number | null;
  benchCapPercent: number | null;
  allowNegativeBalance: boolean | null;
  executionDelaySeconds: number | null;
  feeUsd: number | null;
};

// Same fields as TraderSimSettings, but resolved - never null except where null genuinely means "disabled".
export type EffectiveSettings = {
  allocationUsd: number;
  tradeSizeUsd: number;
  dustBuyUsd: number;
  dustSellFractionPercent: number;
  stopLossPercent: number | null; // null = disabled
  takeProfitPercent: number | null; // null = disabled
  benchCapPercent: number | null; // null = disabled
  allowNegativeBalance: boolean;
  executionDelaySeconds: number;
  feeUsd: number;
};

/** Today's (UTC) sim P&L quick-stats, bundled onto every trader in the list view. */
export type TodayStats = {
  date: string;
  actualizedUsd: number | null;
  actualizedPercent: number | null;
  combinedUsd: number;
  combinedPercent: number;
  closedTradeCount: number;
  wins: number;
  losses: number;
  winRatePercent: number | null;
};

/** Negative-balance crossings (count + deepest point) within exactly one UTC calendar day. */
export type NegativeBalanceDayStats = {
  date: string;
  count: number;
  maxDepthUsd: number;
};

export type Trader = {
  _id: string;
  address: string;
  label: string;
  notes: string;
  status: "active" | "blacklisted";
  muted: boolean; // resolved (falls back to global default when no override)
  mutedOverride: boolean | null; // the trader's own explicit override, if any
  addedAt: string;
  blacklistedAt: string | null;
  stats: TraderStats; // the tracked wallet's own on-chain stats - not shown in the UI, kept for internal bookkeeping
  sim: SimStats;
  settings: TraderSimSettings;
  today: TodayStats;
  todayNegativeBalance: NegativeBalanceDayStats;
  // balance + current mark-to-market value of open positions - distinct from sim.balanceUsd (uncommitted cash only)
  walletValueUsd: number;
};

export type SimPosition = {
  _id: string;
  traderAddress: string;
  mint: string;
  status: "open" | "closed";
  tokenAmount: number;
  costBasisUsd: number;
  buyFeeUsd: number;
  buyPriceUsd: number;
  openedAt: string;
  openTriggerSignature: string;
  benchArmed: boolean;
  // Peak reached at any point while open (sampled on the risk-check interval, plus the closing price itself).
  // Nullable in the type even though the schema requires it on new writes:
  // documents created before this field existed can still be missing it
  // until backfilled, and .lean() reads don't apply Mongoose defaults to
  // already-stored documents - always guard before calling .toFixed() etc.
  maxValueUsd: number | null;
  maxUnrealizedPnlUsd: number | null;
  maxUnrealizedPnlPercent: number | null;
  closedAt: string | null;
  closeReason: "trader_sell" | "stop_loss" | "take_profit" | "bench" | null;
  closeTriggerSignature: string | null;
  sellPriceUsd: number | null;
  proceedsUsd: number | null;
  sellFeeUsd: number | null;
  realizedPnlUsd: number | null;
  realizedPnlPercent: number | null;
  // Only present on OPEN positions (live-priced by the API at read time).
  currentPriceUsd?: number | null;
  currentValueUsd?: number | null;
  unrealizedPnlUsd?: number | null;
  unrealizedPnlPercent?: number | null;
};

export type TraderDetail = Trader & {
  openPositions: SimPosition[]; // live-priced
  unrealizedPnlUsd: number;
  effectiveSettings: EffectiveSettings;
};

export type DailyPnl = {
  date: string;
  actualizedUsd: number | null;
  actualizedPercent: number | null;
  combinedUsd: number;
  combinedPercent: number;
  closedTradeCount: number;
  wins: number;
  losses: number;
};

export type Streaks = {
  profitableDays: number;
  lossDays: number;
  neutralDays: number;
  longestProfitStreak: number;
  longestLossStreak: number;
  currentStreak: { type: "profit" | "loss" | "none"; length: number };
};

export type PnlBreakdown = {
  period: "day" | "week" | "month";
  days: number;
  actualizedUsd: number | null;
  combinedUsd: number;
  combinedPercent: number;
  closedTradeCount: number;
  wins: number;
  losses: number;
  winRatePercent: number | null;
  averageTradesPerDay: number;
  dailyBreakdown: DailyPnl[];
  streaks: Streaks;
  negativeBalanceBreakdown: NegativeBalanceDayStats[];
};

/** The tracked wallet's own on-chain buy/sell signal - kept only as the trigger record, not surfaced as "their" P&L/volume in the UI. */
export type Trade = {
  _id: string;
  traderAddress: string;
  signature: string;
  type: "buy" | "sell";
  program: string;
  mint: string;
  tokenAmount: number | null;
  solAmount: number | null;
  solAmountSource: string | null;
  isNativeSolQuote: boolean;
  quoteMint: string | null;
  slot: number | null;
  blockTime: number | null;
  recordedAt: string;
};

export type GlobalSettings = {
  _id: string;
  key: string;
  defaultMuted: boolean;
  defaultAllocationUsd: number;
  defaultTradeSizeUsd: number;
  defaultDustBuyUsd: number;
  defaultDustSellFractionPercent: number;
  defaultStopLossPercent: number | null;
  defaultTakeProfitPercent: number | null;
  defaultBenchCapPercent: number | null;
  defaultAllowNegativeBalance: boolean;
  defaultExecutionDelaySeconds: number;
  defaultFeeUsd: number;
  // System-wide, not a per-trader override - how often stop-loss/take-profit/bench are re-checked.
  riskCheckIntervalSeconds: number;
};

export type LeaderboardEntry = {
  address: string;
  label: string;
  balanceUsd: number;
  startingAllocationUsd: number;
  combinedPercent: number;
  actualizedUsd: number | null;
  closedTradeCount: number;
  streaks: Streaks;
};
