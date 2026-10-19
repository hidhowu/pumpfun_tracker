import { request } from "./api";
import type { EncryptedKey, LiveTransactionsPage, LiveWallet, LiveWalletDetail, LiveWalletListItem } from "./live-wallet-types";

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
