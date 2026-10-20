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
export type ExitMode = "own" | "follow";

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

export type TradingState = {
  connected: boolean;
  tradingMode: TradingMode;
  exitMode: ExitMode;
  buySlippagePercent: number;
  sellSlippagePercent: number;
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
  buySlippagePercent?: number;
  sellSlippagePercent?: number;
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
  dry: { own: LotDryExit | null; follow: LotDryExit | null } | null;
  differenceUsd: number | null;
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
    networkFeesPaidUsd: number;
  } | null;
  dryComparison: { trades: number; ownPnlUsd: number; followPnlUsd: number; ownWinRate: number; followWinRate: number } | null;
  series: Array<{ date: string; livePnlUsd: number; simPnlUsd: number; trades: number }>;
};

export type BurnEmptyResult = { closed: number; reclaimedLamports: number; failed: number; skipped: number };

/** The live wallet connected to a simulation wallet, for the simulation wallet's page. */
export type LinkedLive = {
  live: { _id: string; name: string; address: string; tradingMode: TradingMode; exitMode: ExitMode };
  balance: { solBalance: number; totalValueUsd: number } | null;
  summary: TradingSummary;
};
