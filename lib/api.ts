import type {
  EffectiveSettings,
  GlobalSettings,
  LeaderboardEntry,
  PnlBreakdown,
  SimPosition,
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

export function listTraders(status?: "active" | "blacklisted"): Promise<{ traders: Trader[] }> {
  const qs = status ? `?status=${status}` : "";
  return request(`/api/traders${qs}`);
}

export function getTrader(address: string): Promise<{ trader: TraderDetail }> {
  return request(`/api/traders/${address}`);
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
  address: string,
  patch: Partial<{ status: "active" | "blacklisted"; muted: boolean | null; label: string; notes: string }>
): Promise<{ trader: TraderDetail }> {
  return request(`/api/traders/${address}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getSettings(): Promise<{ settings: GlobalSettings }> {
  return request(`/api/settings`);
}

export function updateSettings(patch: Partial<GlobalSettings>): Promise<{ settings: GlobalSettings }> {
  return request(`/api/settings`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getPositions(
  address: string,
  status: "open" | "closed",
  page = 1,
  limit = 25
): Promise<{ positions: SimPosition[]; page: number; totalPages: number; total: number }> {
  return request(`/api/traders/${address}/positions?status=${status}&page=${page}&limit=${limit}`);
}

export function getPnl(address: string, period: "day" | "week" | "month" = "week"): Promise<PnlBreakdown> {
  return request(`/api/traders/${address}/pnl?period=${period}`);
}

export function adjustBalance(
  address: string,
  amountUsd: number,
  reason?: string
): Promise<{ balanceUsd: number }> {
  return request(`/api/traders/${address}/balance`, { method: "POST", body: JSON.stringify({ amountUsd, reason }) });
}

export function updateTraderSettings(
  address: string,
  patch: Partial<TraderSimSettings>
): Promise<{ settings: TraderSimSettings; effectiveSettings: EffectiveSettings }> {
  return request(`/api/traders/${address}/settings`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function getLeaderboard(period: "day" | "week" | "month" = "week"): Promise<{ period: string; leaderboard: LeaderboardEntry[] }> {
  return request(`/api/leaderboard?period=${period}`);
}

/** Wipes this trader's simulation state (positions, pending fills, P&L history) and resets balance back to their starting allocation. */
export function resetTrader(address: string): Promise<{ trader: TraderDetail }> {
  return request(`/api/traders/${address}/reset`, { method: "POST" });
}

/** Wipes simulation state for every active trader. Destructive - confirm before calling. */
export function resetAllTraders(): Promise<{ reset: string[] }> {
  return request(`/api/traders/reset-all`, { method: "POST" });
}
