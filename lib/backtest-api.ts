import { request } from "./api";
import type {
  BacktestAddressDetail,
  BacktestAddressPnl,
  BacktestAddressView,
  BacktestCombinedConfig,
  BacktestCombinedWallet,
  BacktestDaily,
  BacktestEquityPoint,
  BacktestPnlPeriod,
  BacktestPositionView,
  BacktestRunDetail,
  BacktestRunSummary,
  BacktestSettingsView,
  BacktestTraderQuery,
  BacktestTradersPage,
  BacktestStoredSettings,
} from "./backtest-types";

type AddResult = { added: string[]; updated?: string[]; skipped: string[]; blacklisted?: string[]; invalid: string[] };
export type AddressEntry = string | { address: string; label?: string; userId?: string };

export function listBacktestAddresses(): Promise<{ addresses: BacktestAddressView[] }> {
  return request(`/api/backtest/addresses`);
}

export function addBacktestAddresses(entries: AddressEntry[]): Promise<AddResult> {
  return request(`/api/backtest/addresses`, { method: "POST", body: JSON.stringify({ entries }) });
}

/** Copies the live active traders (or just one list's) onto the backtest list. */
export function importTradersToBacktest(listId?: string): Promise<AddResult> {
  return request(`/api/backtest/addresses/import`, { method: "POST", body: JSON.stringify({ listId }) });
}

export type BlacklistResult = { blacklisted: string[]; alreadyBlacklisted: string[]; liveBlacklisted: string[]; closingPositions: number };

/** Blacklists addresses on the shared blacklist (blocking them from live trading too), blacklisting any that are live traders, and removes them from the backtest list. */
export function blacklistBacktestAddresses(addresses: string[]): Promise<BlacklistResult> {
  return request(`/api/backtest/addresses/blacklist`, { method: "POST", body: JSON.stringify({ addresses }) });
}

export function deleteBacktestAddresses(addresses: string[]): Promise<{ deletedCount: number }> {
  return request(`/api/backtest/addresses/bulk-delete`, { method: "POST", body: JSON.stringify({ addresses }) });
}

export function updateBacktestAddress(address: string, patch: { label?: string; notes?: string }): Promise<{ address: BacktestAddressView }> {
  return request(`/api/backtest/addresses/${address}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function listBacktestRuns(): Promise<{ runs: BacktestRunSummary[] }> {
  return request(`/api/backtest/runs`);
}

export type TimingOverrides = { executionDelaySeconds?: number; riskCheckIntervalSeconds?: number; fillLatencySeconds?: number };

/** What a combined backtest may change on top of the timing: the amount of every trade and the fees. */
export type CombinedOverrides = TimingOverrides & { tradeSizeUsd?: number; pumpFeePercent?: number; jitoFeeUsd?: number };

export type EarlyStopRules = { lossDays: number; dayLossPercent: number; negativeBalanceEvents: number; lossAtProgressPercent: number };

export function createBacktestRun(body: {
  name?: string;
  days: number;
  profileId: string;
  addresses: string[];
  maxSignatures?: number;
  collectMethod?: "api" | "rpc";
  overrides?: CombinedOverrides;
  earlyStop?: EarlyStopRules;
  addressParallelism?: number | null;
  daysAtOnce?: number;
  mode?: "separate" | "combined";
  combined?: Partial<BacktestCombinedConfig> & { startingBalanceUsd: number };
}): Promise<{ run: BacktestRunSummary }> {
  return request(`/api/backtest/runs`, { method: "POST", body: JSON.stringify(body) });
}

export function getBacktestRun(id: string): Promise<BacktestRunDetail> {
  return request(`/api/backtest/runs/${id}`);
}

/** "restart" starts the whole backtest again from the first address (optionally reading the trades the other way); the others are as their names say. */
export function controlBacktestRun(
  id: string,
  action: "pause" | "resume" | "cancel" | "retry_failed" | "retry_skipped" | "restart",
  options: { collectMethod?: "api" | "rpc" } = {}
): Promise<{ run: BacktestRunSummary }> {
  return request(`/api/backtest/runs/${id}`, { method: "PATCH", body: JSON.stringify({ action, ...options }) });
}

function tradersQuery(q: BacktestTraderQuery): URLSearchParams {
  const qs = new URLSearchParams({ filter: q.filter, sort: q.sort, dir: q.dir, page: String(q.page), limit: String(q.limit) });
  for (const key of ["minWinRate", "minMargin", "maxLossDays", "minTrades", "maxTrades", "minAvgPnl"] as const) {
    if (q.limits[key].trim() !== "") qs.set(key, q.limits[key].trim());
  }
  if (q.limits.holdsWithoutBest) qs.set("holdsWithoutBest", "true");
  return qs;
}

/** A page of a backtest's addresses, filtered and sorted by the server. */
export function getBacktestRunTraders(id: string, query: BacktestTraderQuery): Promise<BacktestTradersPage> {
  return request(`/api/backtest/runs/${id}/traders?${tradersQuery(query)}`);
}

/** Every address that matches the filter and limits (not just the page), to select them all. */
export async function getBacktestMatchingAddresses(id: string, query: BacktestTraderQuery): Promise<string[]> {
  const qs = tradersQuery(query);
  qs.set("addressesOnly", "1");
  const res: { addresses: string[] } = await request(`/api/backtest/runs/${id}/traders?${qs}`);
  return res.addresses;
}

/** Edits a backtest - see updateBacktestRun in db/backtest/service.js for what each field does. */
export function updateBacktestRun(
  id: string,
  update: { name?: string; maxSignatures?: number; profileId?: string; overrides?: CombinedOverrides; earlyStop?: EarlyStopRules; addressParallelism?: number | null; daysAtOnce?: number; combined?: Partial<BacktestCombinedConfig> }
): Promise<{ run: BacktestRunSummary; requeuedSkipped: number; resimulated: boolean }> {
  return request(`/api/backtest/runs/${id}`, { method: "PATCH", body: JSON.stringify({ update }) });
}

export function deleteBacktestRun(id: string): Promise<{ deleted: true }> {
  return request(`/api/backtest/runs/${id}`, { method: "DELETE" });
}

export function getBacktestPositions(
  id: string,
  opts: { address?: string; status?: "closed" | "open" | "skipped"; page?: number; limit?: number } = {}
): Promise<{ positions: BacktestPositionView[]; page: number; total: number; totalPages: number }> {
  const qs = new URLSearchParams();
  if (opts.address) qs.set("address", opts.address);
  if (opts.status) qs.set("status", opts.status);
  if (opts.page) qs.set("page", String(opts.page));
  if (opts.limit) qs.set("limit", String(opts.limit));
  return request(`/api/backtest/runs/${id}/positions?${qs.toString()}`);
}

export function getBacktestDaily(id: string, page = 1, limit = 50): Promise<BacktestDaily> {
  return request(`/api/backtest/runs/${id}/daily?page=${page}&limit=${limit}`);
}

/** The shared wallet of a combined backtest. */
export function getBacktestCombined(id: string): Promise<BacktestCombinedWallet> {
  return request(`/api/backtest/runs/${id}/combined`);
}

export function getBacktestEquity(id: string, address?: string): Promise<{ points: BacktestEquityPoint[] }> {
  return request(`/api/backtest/runs/${id}/equity${address ? `?address=${address}` : ""}`);
}

export function getBacktestAddress(id: string, address: string): Promise<BacktestAddressDetail> {
  return request(`/api/backtest/runs/${id}/addresses/${address}`);
}

export function getBacktestAddressPnl(id: string, address: string, period: BacktestPnlPeriod, date?: string): Promise<BacktestAddressPnl> {
  return request(`/api/backtest/runs/${id}/addresses/${address}/pnl?period=${period}${date ? `&date=${date}` : ""}`);
}

export function promoteBacktestAddresses(
  id: string,
  addresses: string[]
): Promise<{ added: string[]; skipped: string[]; blacklisted: string[]; invalid: string[] }> {
  return request(`/api/backtest/runs/${id}/promote`, { method: "POST", body: JSON.stringify({ addresses }) });
}

export function getBacktestSettings(): Promise<BacktestSettingsView> {
  return request(`/api/backtest/settings`);
}

export function updateBacktestSettings(patch: Partial<Record<keyof BacktestStoredSettings, number | string | null>>): Promise<BacktestSettingsView> {
  return request(`/api/backtest/settings`, { method: "PUT", body: JSON.stringify(patch) });
}
