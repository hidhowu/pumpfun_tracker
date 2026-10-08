import type {
  AddToWalletResult,
  EffectiveSettings,
  GlobalSettings,
  LeaderboardEntry,
  PnlBreakdown,
  HttpRpcEndpointView,
  OpenPositionWithTrader,
  Profile,
  ProxyView,
  RpcEndpointAddress,
  RpcEndpointView,
  TraderListView,
  SimPosition,
  SystemLogEntry,
  Trade,
  Trader,
  TraderDetail,
  TraderSimSettings,
  WalletPnlBreakdown,
  WalletTraderDailyPerformance,
  WalletPositionView,
  WalletSettings,
  WalletTraderPerformance,
  WalletView,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function listTraders(
  profileId: string,
  status?: "active" | "blacklisted",
  listId?: string
): Promise<{ traders: Trader[] }> {
  const qs = new URLSearchParams({ profileId });
  if (status) qs.set("status", status);
  if (listId) qs.set("listId", listId);
  return request(`/api/traders?${qs.toString()}`);
}

export function getTrader(profileId: string, address: string): Promise<{ trader: TraderDetail }> {
  return request(`/api/traders/${address}?profileId=${profileId}`);
}

export function getTrades(
  address: string,
  page = 1,
  limit = 25
): Promise<{ trades: Trade[]; page: number; totalPages: number; total: number }> {
  return request(`/api/traders/${address}/trades?page=${page}&limit=${limit}`);
}

export function addTraderSingle(
  address: string,
  label?: string
): Promise<{ added: string[]; skipped: string[]; blacklisted: string[]; invalid: string[] }> {
  return request(`/api/traders`, { method: "POST", body: JSON.stringify({ address, label }) });
}

export function addTradersBulk(
  addresses: string[]
): Promise<{ added: string[]; skipped: string[]; blacklisted: string[]; invalid: string[] }> {
  return request(`/api/traders`, { method: "POST", body: JSON.stringify({ addresses }) });
}

export function updateTrader(
  profileId: string,
  address: string,
  patch: Partial<{ status: "active" | "blacklisted"; muted: boolean | null; label: string; notes: string }>
): Promise<{ trader: TraderDetail; closedPositions: number; pendingCloses: number }> {
  return request(`/api/traders/${address}?profileId=${profileId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getSettings(profileId: string): Promise<{ settings: GlobalSettings }> {
  return request(`/api/settings?profileId=${profileId}`);
}

export function updateSettings(profileId: string, patch: Partial<GlobalSettings>): Promise<{ settings: GlobalSettings }> {
  return request(`/api/settings?profileId=${profileId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getPositions(
  profileId: string,
  address: string,
  status: "open" | "closed",
  page = 1,
  limit = 25
): Promise<{ positions: SimPosition[]; page: number; totalPages: number; total: number }> {
  return request(`/api/traders/${address}/positions?profileId=${profileId}&status=${status}&page=${page}&limit=${limit}`);
}

export function getPnl(profileId: string, address: string, period: "day" | "week" | "month" = "week"): Promise<PnlBreakdown> {
  return request(`/api/traders/${address}/pnl?profileId=${profileId}&period=${period}`);
}

/** Every open position across every tracked trader, within one profile - not scoped to a single trader like getPositions. */
export function getAllOpenPositions(profileId: string): Promise<{ positions: OpenPositionWithTrader[]; total: number }> {
  return request(`/api/positions/open?profileId=${profileId}`);
}

export function adjustBalance(
  profileId: string,
  address: string,
  amountUsd: number,
  reason?: string
): Promise<{ balanceUsd: number }> {
  return request(`/api/traders/${address}/balance?profileId=${profileId}`, { method: "POST", body: JSON.stringify({ amountUsd, reason }) });
}

export function updateTraderSettings(
  profileId: string,
  address: string,
  patch: Partial<TraderSimSettings>
): Promise<{ settings: TraderSimSettings; effectiveSettings: EffectiveSettings }> {
  return request(`/api/traders/${address}/settings?profileId=${profileId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getLeaderboard(
  profileId: string,
  period: "day" | "week" | "month" = "week"
): Promise<{ period: string; leaderboard: LeaderboardEntry[] }> {
  return request(`/api/leaderboard?profileId=${profileId}&period=${period}`);
}

/** Wipes this trader's simulation state (positions, pending fills, P&L history) and resets balance back to their starting allocation, within one profile. */
export function resetTrader(profileId: string, address: string): Promise<{ trader: TraderDetail }> {
  return request(`/api/traders/${address}/reset?profileId=${profileId}`, { method: "POST" });
}

/** Wipes simulation state for every active trader, within one profile. Destructive - confirm before calling. */
export function resetAllTraders(profileId: string): Promise<{ reset: string[] }> {
  return request(`/api/traders/reset-all?profileId=${profileId}`, { method: "POST" });
}

export function listProfiles(): Promise<{ profiles: Profile[] }> {
  return request(`/api/profiles`);
}

export function createProfile(
  name: string,
  mode: "fresh" | "clone",
  sourceProfileId?: string
): Promise<{ profile: Profile }> {
  return request(`/api/profiles`, { method: "POST", body: JSON.stringify({ name, mode, sourceProfileId }) });
}

export function renameProfile(id: string, name: string): Promise<{ profile: Profile }> {
  return request(`/api/profiles/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteProfile(id: string): Promise<{ deleted: true }> {
  return request(`/api/profiles/${id}`, { method: "DELETE" });
}

export function getLogs(
  category?: "rpc" | "tracker" | "trade",
  limit = 100
): Promise<{ logs: SystemLogEntry[] }> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (category) qs.set("category", category);
  return request(`/api/logs?${qs.toString()}`);
}

/** Asks the tracker daemon to force-reconnect every RPC WebSocket (polled up to ~5s later - see src/tracker.js). */
export function reconnectRpc(): Promise<{ command: { status: string } }> {
  return request(`/api/logs/reconnect`, { method: "POST" });
}

export function listRpcEndpoints(): Promise<{ endpoints: RpcEndpointView[]; unresolvedCount: number; unresolvedAddresses: RpcEndpointAddress[] }> {
  return request(`/api/rpc`);
}

export function addRpcEndpoint(url: string, label?: string): Promise<{ endpoint: RpcEndpointView }> {
  return request(`/api/rpc`, { method: "POST", body: JSON.stringify({ url, label }) });
}

export function updateRpcEndpoint(
  id: string,
  patch: Partial<{ label: string; enabled: boolean }>
): Promise<{ endpoint: RpcEndpointView }> {
  return request(`/api/rpc/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteRpcEndpoint(id: string): Promise<{ deleted: true }> {
  return request(`/api/rpc/${id}`, { method: "DELETE" });
}

/** Reconnects only this one endpoint - others keep running uninterrupted. */
export function reconnectRpcEndpoint(id: string): Promise<{ command: { status: string } }> {
  return request(`/api/rpc/${id}/reconnect`, { method: "POST" });
}

export function getRpcEndpointAddresses(id: string): Promise<{ addresses: RpcEndpointAddress[] }> {
  return request(`/api/rpc/${id}/addresses`);
}

export function listHttpRpcEndpoints(): Promise<{ endpoints: HttpRpcEndpointView[] }> {
  return request(`/api/http-rpc`);
}

export function addHttpRpcEndpoint(url: string, label?: string): Promise<{ endpoint: HttpRpcEndpointView }> {
  return request(`/api/http-rpc`, { method: "POST", body: JSON.stringify({ url, label }) });
}

export function updateHttpRpcEndpoint(
  id: string,
  patch: Partial<{ label: string; enabled: boolean }>
): Promise<{ endpoint: HttpRpcEndpointView }> {
  return request(`/api/http-rpc/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteHttpRpcEndpoint(id: string): Promise<{ deleted: true }> {
  return request(`/api/http-rpc/${id}`, { method: "DELETE" });
}

export function listProxies(): Promise<{ proxies: ProxyView[] }> {
  return request(`/api/proxies`);
}

/** Bulk add - one proxy URL per entry. Duplicates/invalid entries are reported back, never an error. */
export function addProxiesBulk(urls: string[]): Promise<{ added: string[]; skipped: string[]; invalid: string[] }> {
  return request(`/api/proxies`, { method: "POST", body: JSON.stringify({ urls }) });
}

export function updateProxy(id: string, patch: Partial<{ label: string; enabled: boolean }>): Promise<{ proxy: ProxyView }> {
  return request(`/api/proxies/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteProxy(id: string): Promise<{ deleted: true }> {
  return request(`/api/proxies/${id}`, { method: "DELETE" });
}

export function deleteProxiesBulk(ids: string[]): Promise<{ deletedCount: number }> {
  return request(`/api/proxies/bulk-delete`, { method: "POST", body: JSON.stringify({ ids }) });
}

/** Live connectivity check through this one proxy - a pass also un-blacklists it (and re-enables it, with enableOnSuccess). */
export function testProxy(
  id: string,
  options: { enableOnSuccess?: boolean } = {}
): Promise<{ ok: boolean; error: string | null; proxy: ProxyView }> {
  return request(`/api/proxies/${id}/test`, { method: "POST", body: JSON.stringify(options) });
}

export function listTraderLists(): Promise<{ lists: TraderListView[] }> {
  return request(`/api/lists`);
}

export function createTraderList(name: string): Promise<{ list: TraderListView }> {
  return request(`/api/lists`, { method: "POST", body: JSON.stringify({ name }) });
}

export function renameTraderList(id: string, name: string): Promise<{ list: TraderListView }> {
  return request(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteTraderList(id: string): Promise<{ deleted: true }> {
  return request(`/api/lists/${id}`, { method: "DELETE" });
}

export function addTradersToList(listId: string, addresses: string[]): Promise<{ modifiedCount: number }> {
  return request(`/api/lists/${listId}/members`, { method: "POST", body: JSON.stringify({ addresses }) });
}

export function removeTradersFromList(listId: string, addresses: string[]): Promise<{ modifiedCount: number }> {
  return request(`/api/lists/${listId}/members`, { method: "DELETE", body: JSON.stringify({ addresses }) });
}

// --- Wallets ---

export function listWallets(): Promise<{ wallets: WalletView[] }> {
  return request(`/api/wallets`);
}

export function getWallet(id: string): Promise<{ wallet: WalletView }> {
  return request(`/api/wallets/${id}`);
}

export function createWallet(name: string, startingBalanceUsd: number): Promise<{ wallet: WalletView }> {
  return request(`/api/wallets`, { method: "POST", body: JSON.stringify({ name, startingBalanceUsd }) });
}

export function renameWallet(id: string, name: string): Promise<{ wallet: WalletView }> {
  return request(`/api/wallets/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function updateWalletSettings(id: string, settings: Partial<WalletSettings>): Promise<{ wallet: WalletView }> {
  return request(`/api/wallets/${id}`, { method: "PATCH", body: JSON.stringify({ settings }) });
}

export function deleteWallet(id: string): Promise<{ deleted: true }> {
  return request(`/api/wallets/${id}`, { method: "DELETE" });
}

/** Wipes this wallet's trade history (positions, pending fills, daily snapshots) and every assigned trader's per-wallet stats, resetting balance back to the wallet's starting balance. Preserves settings and trader assignments. */
export function resetWallet(id: string): Promise<{ wallet: WalletView }> {
  return request(`/api/wallets/${id}/reset`, { method: "POST" });
}

/** Resets balanceUsd back to startingBalanceUsd only - every position, trade history, and realizedPnlUsd is left untouched. */
export function resetWalletBalance(id: string): Promise<{ wallet: WalletView }> {
  return request(`/api/wallets/${id}/reset-balance`, { method: "POST" });
}

/** Creates a new wallet copied from an existing one. startingBalanceUsd is ignored when copyTrades is true (the new wallet exactly forks the source's current balance/portfolio instead). */
export function duplicateWallet(
  sourceId: string,
  options: { name: string; startingBalanceUsd: number; copySettings: boolean; copyTraders: boolean; copyTrades: boolean }
): Promise<{ wallet: WalletView }> {
  return request(`/api/wallets/${sourceId}/duplicate`, { method: "POST", body: JSON.stringify(options) });
}

export function getWalletTraders(
  id: string,
  period: "day" | "week" | "month" = "day"
): Promise<{ period: string; traders: WalletTraderPerformance[] }> {
  return request(`/api/wallets/${id}/traders?period=${period}`);
}

/** Only active tracked traders are ever assigned - blacklisted ones are always skipped. trackNew also starts tracking addresses not on the platform yet. */
export function addTradersToWallet(
  walletId: string,
  addresses: string[],
  options: { trackNew?: boolean } = {}
): Promise<AddToWalletResult> {
  return request(`/api/wallets/${walletId}/traders`, { method: "POST", body: JSON.stringify({ addresses, ...options }) });
}

export function removeTradersFromWallet(walletId: string, addresses: string[]): Promise<{ removedCount: number }> {
  return request(`/api/wallets/${walletId}/traders`, { method: "DELETE", body: JSON.stringify({ addresses }) });
}

export function getWalletPositions(
  walletId: string,
  status: "open" | "closed",
  page = 1,
  limit = 25
): Promise<{ positions: WalletPositionView[]; page: number; totalPages: number; total: number }> {
  return request(`/api/wallets/${walletId}/positions?status=${status}&page=${page}&limit=${limit}`);
}

/** `date` (YYYY-MM-DD, UTC) picks which day to show for period=day; defaults to today. */
export function getWalletPnl(
  walletId: string,
  period: "day" | "week" | "month" = "week",
  date?: string
): Promise<WalletPnlBreakdown> {
  const qs = new URLSearchParams({ period });
  if (date) qs.set("date", date);
  return request(`/api/wallets/${walletId}/pnl?${qs.toString()}`);
}

/** Every assigned trader's realized P&L + trade count for each of the last 7 days, scoped to this wallet. */
export function getWalletTradersDaily(walletId: string): Promise<{ dates: string[]; traders: WalletTraderDailyPerformance[] }> {
  return request(`/api/wallets/${walletId}/traders/daily`);
}

/** Every walletId this trader is currently assigned to - for the per-trader "Add to Wallet" menu. */
export function getWalletMembership(traderAddress: string): Promise<{ walletIds: string[] }> {
  return request(`/api/wallets/membership?traderAddress=${traderAddress}`);
}
