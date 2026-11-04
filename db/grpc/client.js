import { normalizeTrade, normalizeUserTrade } from "../backtest/pumpTradesClient.js";
import { getBacktestSettingsDoc } from "../backtest/settings.js";

/**
 * The app's side of the standalone gRPC tracking server (the grpc-latency project's server.js): it follows the tracked wallets and tokens over
 * Yellowstone gRPC, stores their trades, and answers over plain HTTP on this machine - no proxies, no pump.fun API.
 *
 *   GRPC_TRACKER_URL   where the server listens, e.g. http://127.0.0.1:4010 (unset = the old pump.fun API reads stay in use)
 *   GRPC_TRACKER_KEY   the server's SERVER_API_KEY
 */

const TIMEOUT_MS = 4000;
const CHAIN = "solana%3A5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"; // pump.fun's path part; the server accepts it for compatibility
const SETTINGS_REFRESH_MS = 15_000;

export const grpcTrackerUrl = () => (process.env.GRPC_TRACKER_URL || "").trim().replace(/\/+$/, "");
export const grpcTrackerConfigured = () => grpcTrackerUrl() !== "";

async function call(method, path, body) {
  const base = grpcTrackerUrl();
  if (!base) throw new Error("GRPC_TRACKER_URL is not set");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.GRPC_TRACKER_KEY || ""}`, ...(body !== undefined && { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`gRPC tracker ${method} ${path} answered HTTP ${res.status}`);
  return res.json();
}

/** Makes the server track exactly these wallets (the traders of the wallets set to "grpc"). Idempotent: safe to call every few seconds. */
export const syncTrackedWallets = (addresses) => call("PUT", "/wallets", { wallets: addresses.map((address) => ({ address })) });

/** Tells the server to start tracking a token (or counts as a request for it, which keeps it tracked). */
export const trackToken = (mint) => call("POST", "/tokens", { mints: [mint] });

let lastTrackErrorAt = 0;
/** trackToken for a place that must not wait for it or fail because of it. */
export function trackTokenInBackground(mint, onError = () => {}) {
  if (!grpcTrackerConfigured()) return;
  trackToken(mint).catch((err) => {
    if (Date.now() - lastTrackErrorAt < 60_000) return;
    lastTrackErrorAt = Date.now();
    onError(err);
  });
}

export const trackerStatus = () => call("GET", "/status");

/**
 * Reads token trades from the server in the shape PumpTradesClient reads them from pump.fun (rows of /trades/<chain>/<mint>), with the
 * methods the live simulation uses: fetchRange (pool price at a moment, db/simulation/apiPlus.js) and fetchRecentTokenTrades (the buy check).
 * Every read counts as a request for the token on the server, which is what keeps it tracked.
 */
export class LocalTradesClient {
  constructor() {
    this.settings = null;
    this.refreshedAt = 0;
    this.stats = { requests: 0, failures: 0 };
  }

  // The same dust floor and venue the backtest reads pump.fun with (BacktestSettings.minSolAmount / program), so a live run and a backtest of
  // the same trade see the same trades.
  async #settings() {
    if (this.settings && Date.now() - this.refreshedAt < SETTINGS_REFRESH_MS) return this.settings;
    try {
      const doc = await getBacktestSettingsDoc();
      this.settings = { minSolAmount: doc.minSolAmount ?? 0, program: doc.program ?? "" };
      this.refreshedAt = Date.now();
    } catch (err) {
      if (!this.settings) throw err;
    }
    return this.settings;
  }

  async #get(path, params) {
    this.stats.requests += 1;
    try {
      return await call("GET", `${path}?${new URLSearchParams(params)}`);
    } catch (err) {
      this.stats.failures += 1;
      throw err;
    }
  }

  /** The newest trades of a token, newest first; `minUsd` filters out smaller ones. Unlike pump.fun's API, a token the server has not seen trade yet gives []. */
  async fetchRecentTokenTrades(mint, { limit = 1, minUsd = 0 } = {}) {
    const params = { limit: String(limit) };
    if (minUsd > 0) params.minUsd = String(minUsd);
    return (await this.#get(`/trades/${CHAIN}/${encodeURIComponent(mint)}`, params)).trades || [];
  }

  /**
   * One page of a tracked wallet's own swaps, newest first - pump.fun's /user-trades/<wallet> (same `cursor`, same `nextCursor`, `minUsd` filter).
   * A wallet the server is not tracking gives an empty page.
   * @returns {Promise<{trades: object[], nextCursor: string|null}>}
   */
  async fetchUserTrades(wallet, cursor, { limit = 100, minUsd = 0 } = {}) {
    const params = { types: "trades", limit: String(limit) };
    if (cursor) params.cursor = cursor;
    if (minUsd > 0) params.minUsd = String(minUsd);
    this.stats.requests += 1;
    try {
      const json = await call("GET", `/user-trades/${encodeURIComponent(wallet)}?${new URLSearchParams(params)}`);
      return { trades: (json.trades || []).map(normalizeUserTrade), nextCursor: json.nextCursor || null };
    } catch (err) {
      if (/HTTP 404/.test(err.message)) return { trades: [], nextCursor: null };
      this.stats.failures += 1;
      throw err;
    }
  }

  /**
   * Every trade with `fromSec <= timestamp <= toSec`, oldest first, and `prior` = the newest trade before `fromSec` (the price to fall back on when
   * nothing traded inside the window). Same result shape as PumpTradesClient.fetchRange; the server answers in one request, so there is one "page".
   */
  async fetchRange(mint, fromSec, toSec) {
    const s = await this.#settings();
    const params = { from: String(fromSec), to: String(toSec) };
    if (s.minSolAmount > 0) params.minSol = String(s.minSolAmount);
    if (s.program === "pump") params.venue = "pump";
    const json = await this.#get(`/trades/${CHAIN}/${encodeURIComponent(mint)}`, params);
    const trades = (json.trades || []).map(normalizeTrade).sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const prior = json.prior ? normalizeTrade(json.prior) : null;
    return { trades, prior, pages: 1, exhausted: true, truncated: false };
  }
}
