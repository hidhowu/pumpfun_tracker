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

export type LiveTxKind = "buy" | "sell" | "receive" | "send" | "sol_in" | "sol_out" | "other" | "failed";

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
