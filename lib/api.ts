import type {
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
  SimPosition,
  SystemLogEntry,
  Trade,
  Trader,
  TraderDetail,
  TraderSimSettings,
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

export function listTraders(profileId: string, status?: "active" | "blacklisted"): Promise<{ traders: Trader[] }> {
  const qs = new URLSearchParams({ profileId });
  if (status) qs.set("status", status);
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
): Promise<{ added: string[]; skipped: string[]; invalid: string[] }> {
  return request(`/api/traders`, { method: "POST", body: JSON.stringify({ address, label }) });
}

export function addTradersBulk(
  addresses: string[]
): Promise<{ added: string[]; skipped: string[]; invalid: string[] }> {
  return request(`/api/traders`, { method: "POST", body: JSON.stringify({ addresses }) });
}

export function updateTrader(
  profileId: string,
  address: string,
  patch: Partial<{ status: "active" | "blacklisted"; muted: boolean | null; label: string; notes: string }>
): Promise<{ trader: TraderDetail }> {
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

/** Live connectivity check through this one proxy - a pass also un-blacklists it. */
export function testProxy(id: string): Promise<{ ok: boolean; error: string | null; proxy: ProxyView }> {
  return request(`/api/proxies/${id}/test`, { method: "POST" });
}
