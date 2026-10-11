import { request } from "./api";
import type {
  BacktestAddressDetail,
  BacktestAddressPnl,
  BacktestAddressView,
  BacktestDaily,
  BacktestEquityPoint,
  BacktestPnlPeriod,
  BacktestPositionView,
  BacktestRunDetail,
  BacktestRunSummary,
  BacktestSettingsView,
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

export function createBacktestRun(body: { name?: string; days: number; profileId: string; addresses: string[]; maxSignatures?: number }): Promise<{ run: BacktestRunSummary }> {
  return request(`/api/backtest/runs`, { method: "POST", body: JSON.stringify(body) });
}

export function getBacktestRun(id: string): Promise<BacktestRunDetail> {
  return request(`/api/backtest/runs/${id}`);
}

export function controlBacktestRun(id: string, action: "pause" | "resume" | "cancel" | "retry_failed" | "retry_skipped"): Promise<{ run: BacktestRunSummary }> {
  return request(`/api/backtest/runs/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
}

/** Edits a backtest - see updateBacktestRun in db/backtest/service.js for what each field does. */
export function updateBacktestRun(
  id: string,
  update: { name?: string; maxSignatures?: number; profileId?: string }
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

export function getBacktestDaily(id: string): Promise<BacktestDaily> {
  return request(`/api/backtest/runs/${id}/daily`);
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
