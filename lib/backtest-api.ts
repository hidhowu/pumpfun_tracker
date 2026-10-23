import { request } from "./api";
import type {
  BacktestAddressDetail,
  BacktestAddressPnl,
  BacktestAddressesPage,
  BacktestAddressView,
  BacktestCombinedConfig,
  BacktestCombinedWallet,
  BacktestViewConfig,
  BacktestViewDefinition,
  BacktestViewImportPreview,
  BacktestViewImportResult,
  BacktestViewList,
  BacktestViewWallet,
  BacktestDaily,
  BacktestEquityPoint,
  BacktestPnlPeriod,
  BacktestPositionView,
  BacktestRunDetail,
  AddToRunResult,
  BacktestRunSummary,
  BacktestSettingsView,
  BacktestStatus,
  MergePreview,
  BacktestTraderQuery,
  BacktestTradersPage,
  BacktestStoredSettings,
} from "./backtest-types";

type AddResult = { added: string[]; updated?: string[]; skipped: string[]; blacklisted?: string[]; invalid: string[] };
export type AddressEntry = string | { address: string; label?: string; userId?: string };

/** One page of the backtest list (newest first). `search` matches text in the address or label. */
export function listBacktestAddresses(opts: { page?: number; limit?: number; search?: string } = {}): Promise<BacktestAddressesPage> {
  const qs = new URLSearchParams({ page: String(opts.page ?? 1), limit: String(opts.limit ?? 50) });
  if (opts.search?.trim()) qs.set("search", opts.search.trim());
  return request(`/api/backtest/addresses?${qs}`);
}

/**
 * Rows `from` to `to` (1-based, inclusive) of the list in the order it is shown - newest first - among the addresses that match the search.
 * "The first 2,500" is from 1 to 2500; "the next 2,500" is 2501 to 5000. The row numbers shift when addresses are removed.
 */
export async function getBacktestAddressRange(from: number, to: number, search = ""): Promise<string[]> {
  const qs = new URLSearchParams({ idsOnly: "1", skip: String(Math.max(0, from - 1)), count: String(Math.max(1, to - from + 1)) });
  if (search.trim()) qs.set("search", search.trim());
  const res: { addresses: string[] } = await request(`/api/backtest/addresses?${qs}`);
  return res.addresses;
}

/** Every address on the list that matches the search (not just a page), to select them all. */
export async function getMatchingBacktestAddresses(search = ""): Promise<string[]> {
  const qs = new URLSearchParams({ idsOnly: "1" });
  if (search.trim()) qs.set("search", search.trim());
  const res: { addresses: string[] } = await request(`/api/backtest/addresses?${qs}`);
  return res.addresses;
}

export function addBacktestAddresses(entries: AddressEntry[]): Promise<AddResult> {
  return request(`/api/backtest/addresses`, { method: "POST", body: JSON.stringify({ entries }) });
}

/**
 * Copies the live active traders (or just one list's) onto the backtest list, a page at a time so any number is fine. `onProgress(done, total)`
 * is called after every page.
 */
export async function importTradersToBacktest(listId?: string, onProgress?: BatchProgress): Promise<AddResult> {
  const total: AddResult = { added: [], updated: [], skipped: [], blacklisted: [], invalid: [] };
  let afterId: string | null = null;
  let done = 0;
  let size = 0;
  do {
    const res: AddResult & { nextAfterId: string | null; total?: number; scanned: number } = await withRetry(() =>
      request(`/api/backtest/addresses/import`, { method: "POST", body: JSON.stringify({ listId, afterId }) })
    );
    total.added.push(...res.added);
    total.updated!.push(...(res.updated ?? []));
    total.skipped.push(...res.skipped);
    total.blacklisted!.push(...(res.blacklisted ?? []));
    total.invalid.push(...res.invalid);
    if (res.total != null) size = res.total;
    done += res.scanned;
    afterId = res.nextAfterId;
    onProgress?.(Math.min(done, size || done), size || done);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } while (afterId);
  return total;
}

export type BlacklistResult = { blacklisted: string[]; alreadyBlacklisted: string[]; liveBlacklisted: string[]; closingPositions: number };

/** Blacklists addresses on the shared blacklist (blocking them from live trading too), blacklisting any that are live traders, and removes them from the backtest list. */
export function blacklistBacktestAddresses(addresses: string[]): Promise<BlacklistResult> {
  return request(`/api/backtest/addresses/blacklist`, { method: "POST", body: JSON.stringify({ addresses }) });
}

export function deleteBacktestAddresses(addresses: string[]): Promise<{ deletedCount: number }> {
  return request(`/api/backtest/addresses/bulk-delete`, { method: "POST", body: JSON.stringify({ addresses }) });
}

/** A call tried twice: a brief hiccup shouldn't abandon a long job. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return call();
  }
}

// Operations on many addresses are sent in batches, one after the other: one giant request would hang the page and the server.
const OP_BATCH = 5000;
const BLACKLIST_BATCH = 200; // blacklisting a live trader also sells its open positions, so each address can cost more
const RETRY_DELAY_MS = 1500;
export type BatchProgress = (done: number, total: number) => void;

async function inBatches<T>(items: string[], size: number, send: (batch: string[]) => Promise<T>, onResult: (result: T) => void, onProgress?: BatchProgress) {
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    let result: T;
    try {
      result = await send(batch);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS)); // a brief hiccup shouldn't abandon a long job
      result = await send(batch);
    }
    onResult(result);
    onProgress?.(Math.min(items.length, i + batch.length), items.length);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the page repaint between batches
  }
}

/** Removes any number of addresses from the backtest list, in batches. */
export async function deleteBacktestAddressesBatched(addresses: string[], onProgress?: BatchProgress): Promise<{ deletedCount: number }> {
  let deletedCount = 0;
  await inBatches(addresses, OP_BATCH, (batch) => deleteBacktestAddresses(batch), (r) => (deletedCount += r.deletedCount), onProgress);
  return { deletedCount };
}

/** Blacklists any number of addresses, in batches, and adds up what happened. */
export async function blacklistBacktestAddressesBatched(addresses: string[], onProgress?: BatchProgress): Promise<BlacklistResult> {
  const total: BlacklistResult = { blacklisted: [], alreadyBlacklisted: [], liveBlacklisted: [], closingPositions: 0 };
  await inBatches(
    addresses,
    BLACKLIST_BATCH,
    (batch) => blacklistBacktestAddresses(batch),
    (r) => {
      total.blacklisted.push(...r.blacklisted);
      total.alreadyBlacklisted.push(...r.alreadyBlacklisted);
      total.liveBlacklisted.push(...r.liveBlacklisted);
      total.closingPositions += r.closingPositions;
    },
    onProgress
  );
  return total;
}

export function updateBacktestAddress(address: string, patch: { label?: string; notes?: string }): Promise<{ address: BacktestAddressView }> {
  return request(`/api/backtest/addresses/${address}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function listBacktestRuns(address = ""): Promise<{ runs: BacktestRunSummary[] }> {
  return request(`/api/backtest/runs${address ? `?address=${encodeURIComponent(address)}` : ""}`);
}

export type TimingOverrides = { executionDelaySeconds?: number; riskCheckIntervalSeconds?: number; fillLatencySeconds?: number };

/** What a combined backtest may change on top of the timing: the amount of every trade and the fees. */
export type CombinedOverrides = TimingOverrides & { tradeSizeUsd?: number; pumpFeePercent?: number; jitoFeeUsd?: number };

export type EarlyStopRules = { lossDays: number; dayLossPercent: number; negativeBalanceEvents: number; lossAtProgressPercent: number };

export function createBacktestRun(body: {
  name?: string;
  days: number;
  profileId: string;
  /** The addresses to run - or leave out and set `allAddresses` to run everything on the list (read by the server). */
  addresses?: string[];
  allAddresses?: boolean;
  search?: string;
  maxSignatures?: number;
  collectMethod?: "api" | "rpc";
  overrides?: CombinedOverrides;
  earlyStop?: EarlyStopRules;
  addressParallelism?: number | null;
  daysAtOnce?: number;
  mode?: "separate" | "combined";
  combined?: Partial<BacktestCombinedConfig> & { startingBalanceUsd: number };
}): Promise<{ run: BacktestRunSummary; queuePosition: number | null }> {
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
  if (q.search.trim()) qs.set("search", q.search.trim());
  for (const key of ["minWinRate", "minMargin", "maxLossDays", "minTrades", "maxTrades", "minAvgPnl", "minPnl", "minAvgPnlPerDay", "minProfitDaysPercent", "maxTotalLoss", "maxDayLossPercent"] as const) {
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

/** Every combined view of a backtest with its headline numbers. */
export function listBacktestViews(id: string): Promise<BacktestViewList> {
  return request(`/api/backtest/runs/${id}/views`);
}

/** Creates one view per entry (no addresses = the whole backtest), all with the same trade amount / fees / balance. Nothing is simulated again. */
export function createBacktestViews(id: string, body: { views: Array<{ name?: string; addresses?: string[] }>; config: BacktestViewConfig }): Promise<{ views: BacktestViewDefinition[] }> {
  return request(`/api/backtest/runs/${id}/views`, { method: "POST", body: JSON.stringify(body) });
}

/** The combined backtests of another backtest, with how many of their addresses `id` also has. */
export function previewBacktestViewImport(id: string, sourceRunId: string): Promise<BacktestViewImportPreview> {
  return request(`/api/backtest/runs/${id}/views/import?sourceRunId=${encodeURIComponent(sourceRunId)}`);
}

/** Copies combined backtests (name, addresses, settings - no trades) from another backtest onto `id`, which uses its own trades for them. */
export function importBacktestViews(id: string, body: { sourceRunId: string; viewIds?: string[]; allowPartial?: boolean }): Promise<BacktestViewImportResult> {
  return request(`/api/backtest/runs/${id}/views/import`, { method: "POST", body: JSON.stringify(body) });
}

export function getBacktestViewWallet(id: string, viewId: string): Promise<BacktestViewWallet> {
  return request(`/api/backtest/runs/${id}/views/${viewId}`);
}

export function updateBacktestView(id: string, viewId: string, patch: { name?: string; addresses?: string[]; config?: Partial<BacktestViewConfig> }): Promise<{ view: BacktestViewDefinition }> {
  return request(`/api/backtest/runs/${id}/views/${viewId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteBacktestView(id: string, viewId: string): Promise<{ deleted: true }> {
  return request(`/api/backtest/runs/${id}/views/${viewId}`, { method: "DELETE" });
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

export type PromoteResult = { added: string[]; skipped: string[]; blacklisted: string[]; invalid: string[]; tagged: number };

/** Adds addresses to the live Traders (and into a trader list, if one is given), in batches, and adds up what happened. */
export async function promoteBacktestAddresses(id: string, addresses: string[], options: { listId?: string; onProgress?: BatchProgress } = {}): Promise<PromoteResult> {
  const total: PromoteResult = { added: [], skipped: [], blacklisted: [], invalid: [], tagged: 0 };
  await inBatches(
    addresses,
    OP_BATCH,
    (batch) => request<PromoteResult>(`/api/backtest/runs/${id}/promote`, { method: "POST", body: JSON.stringify({ addresses: batch, listId: options.listId }) }),
    (r) => {
      total.added.push(...r.added);
      total.skipped.push(...r.skipped);
      total.blacklisted.push(...r.blacklisted);
      total.invalid.push(...r.invalid);
      total.tagged += r.tagged ?? 0;
    },
    options.onProgress
  );
  return total;
}

export type AddToRunTotals = { added: number; alreadyInRun: number; notOnList: number; status: BacktestStatus | null };

/** Adds the given addresses (which must be on the backtest list) to an existing backtest, in batches. */
export async function addAddressesToRunBatched(runId: string, addresses: string[], onProgress?: BatchProgress): Promise<AddToRunTotals> {
  const total: AddToRunTotals = { added: 0, alreadyInRun: 0, notOnList: 0, status: null };
  await inBatches(
    addresses,
    OP_BATCH,
    (batch) => request<AddToRunResult>(`/api/backtest/runs/${runId}/addresses`, { method: "POST", body: JSON.stringify({ addresses: batch }) }),
    (r) => {
      total.added += r.added;
      total.alreadyInRun += r.alreadyInRun;
      total.notOnList += r.notOnList;
      total.status = r.status;
    },
    onProgress
  );
  return total;
}

/** Adds everything on the backtest list that is not in the backtest yet (only what matches `search`, if given), a page at a time. `expected` is for the progress bar. */
export async function addListToRun(runId: string, options: { search?: string; expected?: number; onProgress?: BatchProgress; shouldStop?: () => boolean } = {}): Promise<AddToRunTotals & { stopped: boolean }> {
  const total: AddToRunTotals & { stopped: boolean } = { added: 0, alreadyInRun: 0, notOnList: 0, status: null, stopped: false };
  let afterId: string | null = null;
  let scanned = 0;
  do {
    if (options.shouldStop?.()) {
      total.stopped = true;
      break;
    }
    const res: AddToRunResult = await withRetry(() =>
      request(`/api/backtest/runs/${runId}/addresses`, { method: "POST", body: JSON.stringify({ fromList: true, afterId, search: options.search, limit: OP_BATCH }) })
    );
    total.added += res.added;
    total.alreadyInRun += res.alreadyInRun;
    total.status = res.status;
    scanned += res.scanned;
    afterId = res.nextAfterId;
    options.onProgress?.(scanned, Math.max(scanned, options.expected ?? scanned));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } while (afterId);
  return total;
}

// ----------------------------------------------------------------- merging backtests

/** What merging the sources into the target would do - for the confirmation screen. */
export function previewMerge(targetId: string, sourceIds: string[]): Promise<MergePreview> {
  return request(`/api/backtest/runs/merge`, { method: "POST", body: JSON.stringify({ targetId, sourceIds }) });
}

export type MergeTotals = { moved: number; duplicates: number; removed: string[] };

/**
 * Merges each source into the target (the sources' addresses and results move over; the sources are removed). `rerun(sourceId)` says whether that
 * source's addresses are simulated again by the target. Moves a page at a time so any size works; if it is interrupted, run it again - what has moved stays moved.
 */
export async function mergeBacktests(
  targetId: string,
  sources: Array<{ _id: string; addressCount: number; rerun: boolean }>,
  onProgress?: (done: number, total: number, currentSource: string) => void,
  shouldStop?: () => boolean
): Promise<MergeTotals & { stopped: boolean }> {
  const total: MergeTotals & { stopped: boolean } = { moved: 0, duplicates: 0, removed: [], stopped: false };
  const grand = sources.reduce((n, s) => n + s.addressCount, 0);
  let done = 0;
  for (const source of sources) {
    let afterId: string | null = null;
    do {
      if (shouldStop?.()) {
        total.stopped = true;
        return total;
      }
      const res: { moved: number; duplicates: number; scanned: number; nextAfterId: string | null } = await withRetry(() =>
        request(`/api/backtest/runs/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceId: source._id, afterId, rerun: source.rerun }) })
      );
      total.moved += res.moved;
      total.duplicates += res.duplicates;
      done += res.scanned;
      afterId = res.nextAfterId;
      onProgress?.(Math.min(done, grand), grand, source._id);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } while (afterId);
    await withRetry(() => request(`/api/backtest/runs/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceId: source._id, finish: true }) }));
    total.removed.push(source._id);
  }
  return total;
}

// ----------------------------------------------------------------------- exports

export type RunExportMode = "addresses" | "summary" | "trades";

/** The link that downloads the backtest's addresses as CSV - the same filter, limits, search and sort as `query`. The browser streams the download. */
export function runExportUrl(id: string, query: BacktestTraderQuery, mode: RunExportMode, includeSkipped = false): string {
  const qs = tradersQuery(query);
  qs.delete("page");
  qs.delete("limit");
  qs.set("mode", mode);
  if (includeSkipped) qs.set("includeSkipped", "1");
  return `/api/backtest/runs/${id}/export?${qs}`;
}

/** The link that downloads the backtest list as CSV (only what matches `search`). */
export function addressListExportUrl(search: string, mode: "addresses" | "full"): string {
  const qs = new URLSearchParams({ mode });
  if (search.trim()) qs.set("search", search.trim());
  return `/api/backtest/addresses/export?${qs}`;
}

export function getBacktestSettings(): Promise<BacktestSettingsView> {
  return request(`/api/backtest/settings`);
}

export function updateBacktestSettings(patch: Partial<Record<keyof BacktestStoredSettings, number | string | null>>): Promise<BacktestSettingsView> {
  return request(`/api/backtest/settings`, { method: "PUT", body: JSON.stringify(patch) });
}

export type WalletsFromViewsResult = {
  created: Array<{ walletId: string; name: string; viewId: string; addresses: number; added: number; blacklisted: number; invalid: number }>;
  skipped: Array<{ viewId: string; name: string; reason: string }>;
};

/** Creates one live-tracking wallet per combined view (fresh from its starting balance, no trade history). */
export function createWalletsFromViews(body: { runId: string; viewIds?: string[]; settingsFromWalletId?: string; useWalletMoneySettings?: boolean }): Promise<WalletsFromViewsResult> {
  return request(`/api/wallets/from-backtest`, { method: "POST", body: JSON.stringify(body) });
}
