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

/** One trailing-stop rule: arms once unrealized gain first reaches armPercent, auto-sells if it later falls to exitPercent. */
export type TrailingStop = {
  _id: string;
  armPercent: number;
  exitPercent: number;
};

// Per-trader simulation setting overrides - null means "inherit the global default".
// trailingStops is the exception: null = inherit the global list, an array
// (including []) is a whole-list override for this trader.
export type TraderSimSettings = {
  allocationUsd: number | null;
  tradeSizeUsd: number | null;
  dustBuyUsd: number | null;
  dustSellFractionPercent: number | null;
  stopLossPercent: number | null;
  takeProfitPercent: number | null;
  maxTradeTimeSeconds: number | null; // null = inherit; 0 (inherited or set) = disabled/infinite
  trailingStops: TrailingStop[] | null;
  allowNegativeBalance: boolean | null;
  executionDelaySeconds: number | null;
  pumpFeePercent: number | null;
  jitoFeeUsd: number | null;
};

// Same fields as TraderSimSettings, but resolved - never null except where null genuinely means "disabled".
export type EffectiveSettings = {
  allocationUsd: number;
  tradeSizeUsd: number;
  dustBuyUsd: number;
  dustSellFractionPercent: number;
  stopLossPercent: number | null; // null = disabled
  takeProfitPercent: number | null; // null = disabled
  maxTradeTimeSeconds: number; // 0 = disabled/infinite
  trailingStops: TrailingStop[];
  allowNegativeBalance: boolean;
  executionDelaySeconds: number;
  pumpFeePercent: number; // % of trade value, charged on every buy and sell - see db/fees.js
  jitoFeeUsd: number; // flat USD per buy and per sell
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
  listIds: string[]; // TraderList ids this trader is tagged into
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
  buyFeeUsd: number; // total buy fee (pump % + jito)
  buyPumpFeeUsd?: number | null; // breakdown - null on positions opened before the pump%/jito split
  buyJitoFeeUsd?: number | null;
  buyPriceUsd: number;
  openedAt: string;
  openTriggerSignature: string;
  // _id strings of whichever configured trailing-stop rules have armed for this position - see db/simulation/executor.js.
  armedTrailingStopIds: string[];
  // Peak reached at any point while open (sampled on the risk-check interval, plus the closing price itself).
  // Nullable in the type even though the schema requires it on new writes:
  // documents created before this field existed can still be missing it
  // until backfilled, and .lean() reads don't apply Mongoose defaults to
  // already-stored documents - always guard before calling .toFixed() etc.
  maxValueUsd: number | null;
  maxUnrealizedPnlUsd: number | null;
  maxUnrealizedPnlPercent: number | null;
  // Trough reached at any point while open (same sampling as the peak above).
  // Always nullable end-to-end (schema default null, not required) since it
  // was added after maxValueUsd/etc - no backfill migration was run for it.
  minValueUsd: number | null;
  minUnrealizedPnlUsd: number | null;
  minUnrealizedPnlPercent: number | null;
  closedAt: string | null;
  // "bench" only appears on positions closed before the trailingStops rule list replaced the single bench-cap.
  closeReason: "trader_sell" | "stop_loss" | "take_profit" | "bench" | "trailing_stop" | "max_hold_time" | "blacklisted" | null;
  closeTriggerSignature: string | null;
  sellPriceUsd: number | null;
  proceedsUsd: number | null;
  sellFeeUsd: number | null;
  sellPumpFeeUsd?: number | null;
  sellJitoFeeUsd?: number | null;
  realizedPnlUsd: number | null;
  realizedPnlPercent: number | null;
  // Only present on OPEN positions (live-priced by the API at read time).
  currentPriceUsd?: number | null;
  currentValueUsd?: number | null;
  unrealizedPnlUsd?: number | null;
  unrealizedPnlPercent?: number | null;
};

/** A proxy the pump.fun API client rotates through - see db/models/Proxy.js and db/proxyService.js. */
export type ProxyView = {
  _id: string;
  url: string;
  label: string;
  enabled: boolean; // manual on/off
  status: "active" | "blacklisted"; // auto-managed health
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  createdAt: string;
};

/** One open position from the cross-trader /api/positions/open endpoint - a SimPosition plus which trader it belongs to. */
export type OpenPositionWithTrader = SimPosition & { traderLabel: string };

/** A user-created trader group - see db/models/TraderList.js. */
export type TraderListView = {
  _id: string;
  name: string;
  createdAt: string;
  memberCount: number;
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

/** Merged view of two backend collections: GlobalSettings (per-profile strategy defaults) + SystemSettings (defaultMuted/riskCheckIntervalSeconds, shared across every profile). See app/api/settings/route.ts. */
export type GlobalSettings = {
  _id: string;
  profileId: string;
  defaultMuted: boolean;
  defaultAllocationUsd: number;
  defaultTradeSizeUsd: number;
  defaultDustBuyUsd: number;
  defaultDustSellFractionPercent: number;
  defaultStopLossPercent: number | null;
  defaultTakeProfitPercent: number | null;
  defaultMaxTradeTimeSeconds: number; // 0 = disabled/infinite
  defaultTrailingStops: TrailingStop[];
  defaultAllowNegativeBalance: boolean;
  defaultExecutionDelaySeconds: number;
  defaultPumpFeePercent: number;
  defaultJitoFeeUsd: number;
  // System-wide, not a per-trader override - how often stop-loss/take-profit/trailing-stops are re-checked.
  riskCheckIntervalSeconds: number;
};

/** Operational log entry for the Logs UI section - see db/systemLog.js. Auto-expires after 24h. */
export type SystemLogEntry = {
  _id: string;
  category: "rpc" | "tracker" | "trade";
  level: "info" | "warn" | "error";
  message: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

/** A WebSocket RPC endpoint traders are distributed across - see /rpc and db/rpcAssignment.js. */
export type RpcEndpointView = {
  _id: string;
  url: string;
  label: string;
  enabled: boolean;
  status: "connected" | "disconnected" | "connecting";
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  addressCount: number;
};

/** A plain HTTP RPC endpoint round-robinned for non-websocket Solana calls - see /rpc's second section and src/rpcPool.js. */
export type HttpRpcEndpointView = {
  _id: string;
  url: string;
  label: string;
  enabled: boolean;
  createdAt: string;
};

export type RpcEndpointAddress = {
  address: string;
  label: string;
  subscriptionStatus: "pending" | "subscribed" | "failed";
  // Present on the cross-endpoint "unresolved addresses" list (GET /api/rpc); omitted on a single endpoint's own address list, where it's implicit.
  assignedRpcUrl?: string | null;
};

/** An independent copy-trading strategy - see db/models/Profile.js. */
export type Profile = {
  _id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
};

/** A profile plus its headline numbers, for the /profiles page. P&L is realized, after fees. */
export type ProfileOverview = Profile & {
  realizedPnlUsd: number;
  todayRealizedPnlUsd: number; // trades closed today (UTC)
  todayClosedTrades: number;
  balanceUsd: number;
  startingBalanceUsd: number;
  traderCount: number;
  openTradeCount: number;
  closedTradeCount: number;
  winRatePercent: number | null;
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

// --- Wallets: a second, fully independent copy-trade simulation - see db/models/Wallet.js ---

/** Flat, wallet-own settings - no per-trader-within-wallet override tier (unlike TraderSimSettings). No allowNegativeBalance: wallets can never go negative, not configurable. */
export type WalletSettings = {
  tradeSizeUsd: number;
  dustBuyUsd: number;
  dustSellFractionPercent: number;
  stopLossPercent: number | null; // null = disabled
  takeProfitPercent: number | null; // null = disabled
  maxTradeTimeSeconds: number; // 0 = disabled/infinite
  trailingStops: TrailingStop[];
  executionDelaySeconds: number;
  pumpFeePercent: number;
  jitoFeeUsd: number;
  // When true, balanceUsd auto-resets to startingBalanceUsd once per UTC day
  // - trade history/realizedPnlUsd are untouched. See db/simulation/walletSnapshot.js's applyDailyBalanceResets.
  autoResetBalanceDaily: boolean;
};

export type WalletView = {
  _id: string;
  name: string;
  startingBalanceUsd: number;
  balanceUsd: number;
  realizedPnlUsd: number;
  openPositionCount: number;
  closedPositionCount: number;
  createdAt: string;
  lastAutoResetDate: string | null;
  lastAutoResetAt: string | null;
  settings: WalletSettings;
  traderCount?: number; // present on the /api/wallets list endpoint only
  todayRealizedPnlUsd?: number; // present on the /api/wallets list endpoint only - sum of realizedPnlUsd for positions closed today (UTC)
};

/** One position within a Wallet - field-for-field the same shape as SimPosition, just scoped to a Wallet instead of a (Profile, trader) pair. */
export type WalletPositionView = SimPosition;

/** One assigned trader's stats on the "Traders Performance" tab - scoped ONLY to trades made while on THIS wallet, never the trader's overall/lifetime performance. */
export type WalletTraderPerformance = {
  traderAddress: string;
  label: string;
  addedAt: string;
  lifetimeTrades: number;
  lifetimeRealizedPnlUsd: number;
  openPositionCount: number;
  closedPositionCount: number;
  lastActionAt: string | null;
  periodPnlUsd: number;
  periodTradeCount: number;
  periodWins: number;
  periodLosses: number;
};

export type WalletDailyPnl = {
  date: string;
  valueUsd: number | null; // absolute wallet value that day (end-of-day, or start-of-day if end isn't snapshotted yet) - what the performance chart plots
  actualizedUsd: number | null;
  actualizedPercent: number | null;
  combinedUsd: number;
  combinedPercent: number;
  closedTradeCount: number;
  wins: number;
  losses: number;
};

/** One UTC hour of a day, for the hourly "Day" chart. pnlUsd/tradeCount are realized (trades that closed that hour). */
export type WalletHourlyPnl = {
  hour: number; // 0-23, UTC
  label: string; // "13:00"
  pnlUsd: number;
  cumulativePnlUsd: number | null; // null for hours still in the future
  tradeCount: number;
  wins: number;
  losses: number;
  valueUsd: number | null; // null for future hours / hours with no baseline to measure from
  valueEstimated: boolean; // true when there was no hourly snapshot and the value is the day-open value + realized P&L
};

export type WalletPnlBreakdown = {
  period: "day" | "week" | "month";
  date: string; // the last day covered (UTC) - today unless a past day was requested
  days: number;
  actualizedUsd: number | null;
  combinedUsd: number;
  combinedPercent: number;
  closedTradeCount: number;
  wins: number;
  losses: number;
  winRatePercent: number | null;
  dailyBreakdown: WalletDailyPnl[];
  hourlyBreakdown?: WalletHourlyPnl[]; // period=day only
  streaks: Streaks;
};

/** One trader's realized P&L on one UTC day, on one wallet. */
export type WalletTraderDay = { date: string; pnlUsd: number; tradeCount: number; wins: number; losses: number };

/** One row of the detailed Traders Performance matrix: the last 7 days of a trader's results on this wallet. */
export type WalletTraderDailyPerformance = {
  traderAddress: string;
  label: string;
  daily: WalletTraderDay[];
  totalPnlUsd: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
};

/** Response of POST /api/wallets/[id]/traders - see db/walletService.js's addTradersToWallet. */
export type AddToWalletResult = {
  added: string[];
  alreadyInWallet: string[];
  blacklisted: string[];
  untracked: string[];
  invalid: string[];
  newlyTracked: string[];
};
