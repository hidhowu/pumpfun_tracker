import { request } from "./api";
import type { BurnEmptyResult, BurnResult, EncryptedKey, LiveTransactionsPage, LiveWallet, LiveWalletDetail, LinkedLive, LiveWalletListItem, TradingLotsPage, TradingPatch, TradingState, TradingSummary, TxStats, LookupTableResult, DryDaily, TransferResult } from "./live-wallet-types";

export function listLiveWallets(): Promise<{ wallets: LiveWalletListItem[]; twoFactorEnabled: boolean }> {
  return request("/api/live-wallets");
}

export function createLiveWallet(name: string, clientPublicKey: string): Promise<{ wallet: LiveWallet; key: EncryptedKey }> {
  return request("/api/live-wallets", { method: "POST", body: JSON.stringify({ name, clientPublicKey }) });
}

export function getLiveWallet(id: string): Promise<LiveWalletDetail> {
  return request(`/api/live-wallets/${id}`);
}

export function renameLiveWallet(id: string, name: string): Promise<{ wallet: LiveWallet }> {
  return request(`/api/live-wallets/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function getLiveWalletTransactions(
  id: string,
  opts: { mint?: string; kind?: string; page?: number; limit?: number } = {}
): Promise<LiveTransactionsPage> {
  const qs = new URLSearchParams();
  if (opts.mint) qs.set("mint", opts.mint);
  if (opts.kind) qs.set("kind", opts.kind);
  qs.set("page", String(opts.page ?? 1));
  qs.set("limit", String(opts.limit ?? 25));
  return request(`/api/live-wallets/${id}/transactions?${qs.toString()}`);
}

/** Shows the private key again: needs a fresh authenticator code. The key comes back encrypted for this browser only. */
export function revealLiveWalletKey(id: string, code: string, clientPublicKey: string): Promise<{ key: EncryptedKey }> {
  return request(`/api/live-wallets/${id}/reveal-key`, { method: "POST", body: JSON.stringify({ code, clientPublicKey }) });
}

/** Burns whatever the token account holds and closes it (rent goes back to the wallet), signed server-side with the wallet's key. Irreversible. */
export function burnTokenAccount(walletId: string, account: string): Promise<BurnResult> {
  return request(`/api/live-wallets/${walletId}/burn-token-account`, { method: "POST", body: JSON.stringify({ account }) });
}

// ---------------------------------------------------------------- copy trading

export function getTradingState(walletId: string): Promise<TradingState> {
  return request(`/api/live-wallets/${walletId}/trading`);
}

/** Connects / disconnects a simulation wallet and changes the switches. Going live needs `code`, a fresh authenticator code. */
export function updateTrading(walletId: string, patch: TradingPatch): Promise<TradingState> {
  return request(`/api/live-wallets/${walletId}/trading`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getTradingLots(walletId: string, opts: { status?: "open" | "closed"; page?: number; limit?: number } = {}): Promise<TradingLotsPage> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set("status", opts.status);
  qs.set("page", String(opts.page ?? 1));
  qs.set("limit", String(opts.limit ?? 20));
  return request(`/api/live-wallets/${walletId}/trading/lots?${qs.toString()}`);
}

export function getTradingSummary(walletId: string): Promise<TradingSummary> {
  return request(`/api/live-wallets/${walletId}/trading/summary`);
}

/** What each dry-run exit style made per day over the last 7 days. */
export function getDryDaily(walletId: string): Promise<DryDaily> {
  return request(`/api/live-wallets/${walletId}/trading/dry-daily`);
}

/** Resets the dry run: every exit style starts again from zero on the dry trades opened from now on. Nothing is deleted. */
export function resetDryRun(walletId: string): Promise<{ dryResetAt: string }> {
  return request(`/api/live-wallets/${walletId}/trading/dry-reset`, { method: "POST" });
}

/** Runs the burn engine now: closes every nearly-empty token account of the wallet and returns their deposits. */
export function burnEmptyAccounts(walletId: string): Promise<BurnEmptyResult> {
  return request(`/api/live-wallets/${walletId}/trading/burn-empty`, { method: "POST" });
}

/** The live wallet connected to a simulation wallet, or null. */
export async function getLinkedLive(simWalletId: string): Promise<LinkedLive | null> {
  return (await request<{ link: LinkedLive | null }>(`/api/wallets/${simWalletId}/live`)).link;
}

/** Transaction stats: speed percentiles, successes, failures, retries. `hours` limits them to recent attempts. */
export function getTradingStats(walletId: string, hours?: number): Promise<TxStats> {
  return request(`/api/live-wallets/${walletId}/trading/stats${hours ? `?hours=${hours}` : ""}`);
}

/** Queues a sell of one open live position (for a sell that gave up). */
export function sellLotNow(walletId: string, lotId: string): Promise<{ queued: boolean }> {
  return request(`/api/live-wallets/${walletId}/trading/lots/${lotId}/sell`, { method: "POST" });
}

/** Creates the wallet's lookup table now (or tops it up) so its first trade is fast. Spends about 0.01-0.02 SOL of rent. Can take up to a minute. */
export function createLookupTable(walletId: string): Promise<LookupTableResult> {
  return request(`/api/live-wallets/${walletId}/trading/lookup-table`, { method: "POST" });
}

/** Sends SOL to another live wallet on this platform. Needs a fresh authenticator code. `all` sends everything but the network fee. Can take up to a minute. */
export function transferSol(walletId: string, body: { toWalletId: string; amountSol?: string; all?: boolean; code: string }): Promise<TransferResult> {
  return request(`/api/live-wallets/${walletId}/transfer`, { method: "POST", body: JSON.stringify(body) });
}
