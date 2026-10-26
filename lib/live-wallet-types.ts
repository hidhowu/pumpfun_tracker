export type LiveWallet = {
  _id: string;
  name: string;
  address: string;
  createdAt: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

export type LiveWalletListItem = LiveWallet & {
  solBalance: number | null;
  totalValueUsd: number | null;
  tokenCount: number | null;
  error: string | null;
  realizedPnlUsd: number;
  wins: number;
  losses: number;
  sells: number;
  /** Open positions whose sell gave up and need attention. */
  stuckSells: number;
};

export type LiveHolding = {
  mint: string;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  decimals: number;
  balance: number;
  accounts: number;
  priceUsd: number | null;
  valueUsd: number | null;
  costBasisUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number;
};

export type LiveTokenAccount = {
  account: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  program: "spl-token" | "token-2022";
  balance: number;
  decimals: number;
  state: string;
  rentLamports: number;
};

export type LiveChain = {
  address: string;
  solBalance: number;
  solUsd: number | null;
  solValueUsd: number | null;
  tokensValueUsd: number;
  totalValueUsd: number | null;
  tokens: LiveHolding[];
  accounts: LiveTokenAccount[];
  fetchedAt: number;
};

/** Profit/loss totals - for the whole wallet, or for one token. USD figures are each sell's result at the SOL price when it was synced. */
export type LivePnlStats = {
  buys: number;
  sells: number;
  boughtSol: number;
  soldSol: number;
  realizedPnlSol: number;
  realizedPnlUsd: number;
  profitUsd: number;
  lossUsd: number;
  profitSol: number;
  lossSol: number;
  wins: number;
  losses: number;
};

export type LiveWalletDetail = {
  wallet: LiveWallet;
  twoFactorEnabled: boolean;
  chain: LiveChain | null;
  chainError: string | null;
  syncError: string | null;
  pnl: LivePnlStats & { unrealizedPnlUsd: number };
};

export type LiveTxKind = "buy" | "sell" | "receive" | "send" | "burn" | "sol_in" | "sol_out" | "other" | "failed";

export type LiveTransaction = {
  signature: string;
  kind: LiveTxKind;
  mint: string | null;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  blockTime: string | null;
  tokenDelta: number;
  solDelta: number;
  feeSol: number;
  priceUsd: number | null;
  valueUsd: number | null;
  costBasisUsd: number | null;
  realizedPnlSol: number | null;
  realizedPnlPct: number | null;
  realizedPnlUsd: number | null;
};

export type LiveTransactionsPage = {
  transactions: LiveTransaction[];
  page: number;
  totalPages: number;
  total: number;
  summary: LivePnlStats;
  syncError: string | null;
};

/** The private key, encrypted for one browser only - see lib/live-wallet-crypto.ts. */
export type EncryptedKey = { serverPublicKey: string; salt: string; iv: string; ciphertext: string };

/** What burning and closing a token account did - see db/live/burnTokenAccount.js. "pending" = sent, not yet seen confirmed. */
export type BurnResult = {
  signature: string;
  status: "confirmed" | "pending";
  mint: string;
  burnedRaw: string;
  burned: number;
  decimals: number;
  closed: true;
  reclaimedLamports: number;
};

// ---------------------------------------------------------------- copy trading (db/live/trading/*)

export type TradingMode = "dry" | "live";
/** "own", "follow", or a cool-down style "cd<seconds>" (see CooldownStyle). */
export type ExitMode = string;

/** Within `seconds` of the buy only a stop-loss of `stopLossPercent` (50 = -50%), a take-profit, the max hold time or a trailing stop in profit sells; then the profile's rules apply. */
export type CooldownStyle = { id: string; seconds: number; stopLossPercent: number };

export type TradingSimWallet = {
  _id: string;
  name: string;
  balanceUsd: number;
  startingBalanceUsd: number;
  realizedPnlUsd: number;
  settings: {
    tradeSizeUsd: number;
    pumpFeePercent: number;
    jitoFeeUsd: number;
    stopLossPercent: number | null;
    takeProfitPercent: number | null;
    maxTradeTimeSeconds: number;
    trailingStops: Array<{ armPercent: number; exitPercent: number }>;
    executionDelaySeconds: number;
  };
};

export type SendMode = "raw" | "jito";

/** An open position whose sell gave up. */
export type StuckSell = { lotId: string; mint: string; traderAddress: string; at: string; reason: string; failures: number };

export type TradingState = {
  connected: boolean;
  tradingMode: TradingMode;
  exitMode: ExitMode;
  cooldownStyles: CooldownStyle[];
  buySlippagePercent: number;
  sellSlippagePercent: number;
  /** Seconds the wallet waits after the simulation's decision before a trade is priced and built (0 = at once). */
  tradeDelaySeconds: number;
  maxTradeDelaySeconds: number;
  sendMode: SendMode;
  jitoTipUsd: number | null;
  scaleJitoFee: boolean;
  rawPriorityMicroLamports: number;
  tradeRatioSim: number;
  tradeRatioLive: number;
  paused: boolean;
  lookupTable: string | null;
  /** Accounts in the table (null when there is none, or it can't be read right now). */
  lookupTableAddresses: number | null;
  /** What the settings come to in practice (null while no simulation wallet is connected). */
  effective: { tradeSizeUsd: number; tipUsd: number; assumedTipUsd: number; scale: number } | null;
  stuckSells: StuckSell[];
  connectedAt: string | null;
  lastBurnSweepAt: string | null;
  burnSweepEveryMinutes: number;
  emptyTokenLimit: number;
  solUsd: number | null;
  simWallet: TradingSimWallet | null;
  availableWallets: Array<{ _id: string; name: string; taken: boolean }>;
  warnings: string[];
};

export type TradingPatch = {
  connectedWalletId?: string | null;
  tradingMode?: TradingMode;
  exitMode?: ExitMode;
  cooldownStyles?: Array<{ seconds: number; stopLossPercent?: number }>;
  buySlippagePercent?: number;
  sellSlippagePercent?: number;
  tradeDelaySeconds?: number;
  sendMode?: SendMode;
  jitoTipUsd?: number | null;
  scaleJitoFee?: boolean;
  rawPriorityMicroLamports?: number;
  tradeRatioSim?: number;
  tradeRatioLive?: number;
  paused?: boolean;
  code?: string;
};

export type LotLiveSide = {
  mode: TradingMode;
  verified: boolean;
  venue: "curve" | "amm" | null;
  tokenAmount: number;
  costUsd: number;
  buyPriceUsd: number | null;
  swapSol: number;
  route: string | null;
  sendMode: SendMode | null;
  /** Jito fee counted as a cost though nothing was tipped (raw mode). */
  assumedTipUsd: number;
  tipUsd: number;
  feeUsd: number;
  rentSol: number;
  buySignature: string | null;
  sellSignature: string | null;
  sellPriceUsd: number | null;
  proceedsUsd: number | null;
  pnlUsd: number | null;
  pnlPercent: number | null;
  sellTipUsd: number | null;
  sellFeeUsd: number | null;
  valueUsd?: number;
  unrealizedUsd?: number;
  unrealizedPercent?: number | null;
};

export type LotSimSide = {
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  costUsd: number;
  buyPriceUsd: number;
  sellPriceUsd: number | null;
  tokenAmount: number;
  proceedsUsd: number | null;
  pnlUsd: number | null;
  pnlPercent: number | null;
  valueUsd?: number;
  unrealizedUsd?: number;
  unrealizedPercent?: number | null;
};

export type LotDryExit = { reason: string | null; at: string | null; priceUsd: number | null; proceedsUsd: number | null; pnlUsd: number | null; pnlPercent: number | null };

export type TradingLot = {
  id: string;
  status: "open" | "closed";
  mode: TradingMode;
  traderAddress: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  live: LotLiveSide;
  sim: LotSimSide | null;
  paired: boolean;
  /** Live trade size / simulation trade size: the simulation's dollars times this are comparable with the live ones. */
  scale: number;
  sellFailure: { at: string; reason: string; failures: number } | null;
  /** What each exit style did (null while it has not decided), by style id, in the wallet's order. */
  dry: Record<string, LotDryExit | null> | null;
  differenceUsd: number | null;
  differencePercent: number | null;
};

export type TradingLotsPage = { lots: TradingLot[]; total: number; page: number; totalPages: number };

export type TradingSummary = {
  live: { open: number; closed: number };
  dry: { open: number; closed: number };
  settled: {
    trades: number;
    livePnlUsd: number;
    simPnlUsd: number;
    pairedTrades: number;
    liveWinRate: number | null;
    simWinRate: number | null;
    tipsPaidUsd: number;
    assumedTipsUsd: number;
    networkFeesPaidUsd: number;
  } | null;
  dryComparison: { trades: number; styles: Array<{ id: string; label: string; pnlUsd: number; winRate: number }> } | null;
  series: Array<{ date: string; livePnlUsd: number; simPnlUsd: number; trades: number }>;
};

export type BurnEmptyResult = { closed: number; reclaimedLamports: number; failed: number; skipped: number };

/** The live wallet connected to a simulation wallet, for the simulation wallet's page. */
export type LinkedLive = {
  live: { _id: string; name: string; address: string; tradingMode: TradingMode; exitMode: ExitMode };
  balance: { solBalance: number; totalValueUsd: number } | null;
  summary: TradingSummary;
};

export type Latency = { count: number; minMs: number | null; maxMs: number | null; avgMs: number | null; p10Ms: number | null; p50Ms: number | null; p90Ms: number | null; p95Ms: number | null; p99Ms: number | null };

export type TxCounts = { attempts: number; success: number; reverted: number; expired: number; error: number; retries: number; trades: number; tradesSucceeded: number; tradesFailed: number; successRate: number | null };

export type TxStats = {
  hours: number | null;
  total: TxCounts;
  buy: TxCounts & { latency: Latency };
  sell: TxCounts & { latency: Latency };
  latency: Latency;
  recentLatency: Latency;
  recentWindow: number;
  slowing: boolean;
  byMode: Record<SendMode, TxCounts & { latency: Latency }>;
  recentFailures: Array<{ at: string; action: "buy" | "sell"; mint: string; outcome: "reverted" | "expired" | "error"; attempt: number; error: string | null; sendMode: SendMode | null; signature: string | null }>;
};

export type LookupTableResult = { address: string; total: number; added: number; samples: string[] };
