import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getActiveProxyPool, recordProxyResult } from "./proxyService.js";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 15_000;
const cache = new Map(); // mint -> { data, expiresAt }
// In-flight request coalescing: this module (and its cache above) is
// already the single shared point every consumer in this process goes
// through for a mint's price - every Profile's checkRiskExits, every
// Wallet's checkWalletRiskExits, executeBuy/executeWalletBuy, the
// dashboard's position marking, all of it, call the exact same
// getCoinInfo() in the exact same process, so there's never one real
// network call per Profile/Wallet for the same mint. The one gap the cache
// alone doesn't close: two callers for the SAME mint arriving concurrently
// before either has populated the cache (e.g. a Profile's and a Wallet's
// risk-check tick landing on the same mint at once) would otherwise both
// see a miss and both fire a real curl call. This map holds the in-flight
// promise per mint so every concurrent caller awaits the SAME request
// instead - a second/third caller within an already-running lookup counts
// as a duplicate call. More Wallets/Profiles only ever gets you more
// callers sharing that one in-flight promise, never more real requests.
const inflight = new Map(); // mint -> Promise<data>
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

const STATUS_MARKER = "\n__HTTP_STATUS__";
// How many different proxies to try (round-robin) before giving up on the
// pool entirely for this one call and falling straight through to a direct
// request - kept small so a call with several dead proxies in the pool
// doesn't compound their timeouts into one very slow lookup; the failure
// bookkeeping (db/proxyService.js) that decides blacklisting is cumulative
// across calls over time, so it doesn't need every call to exhaust the pool.
const MAX_PROXY_ATTEMPTS_PER_CALL = 2;
let proxyRoundRobinIndex = 0;

async function runCurl(url, proxyUrl) {
  const args = ["-s", "-m", "10", "-w", `${STATUS_MARKER}%{http_code}`];
  if (proxyUrl) args.push("--proxy", proxyUrl);
  args.push(url);
  const { stdout } = await execFileAsync("curl", args);
  const markerIndex = stdout.lastIndexOf(STATUS_MARKER);
  const body = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
  const status = markerIndex >= 0 ? Number(stdout.slice(markerIndex + STATUS_MARKER.length).trim()) : 0;
  return { status, body };
}

/**
 * pump.fun's frontend API blocks Node's own `fetch` (undici) outright -
 * confirmed by testing: plain `curl` gets HTTP 200 reliably (5/5 attempts,
 * with or without extra headers), while Node's `fetch` gets HTTP 403 every
 * single time even with a browser User-Agent set. That's consistent with
 * TLS/HTTP client fingerprinting (e.g. Cloudflare-style bot protection)
 * rather than a header check, since headers alone didn't change Node's
 * result. Shelling out to curl (present by default on Windows 10+ and any
 * Unix box) is the pragmatic fix, since it demonstrably isn't blocked.
 *
 * Proxy-aware: with proxies configured (managed from the /proxies UI),
 * round-robins through them via `curl --proxy`, retrying the next one on a
 * curl-level failure (couldn't connect, timed out, etc - NOT a legitimate
 * HTTP error from pump.fun itself, which curl reports as a clean exit with
 * that status code, not a thrown error, so a real 404/500 is returned as-is
 * rather than treated as a proxy problem). Every attempt's outcome is
 * recorded (db/proxyService.js) so a proxy that keeps failing gets
 * auto-blacklisted out of future rotations. If every attempt in this call
 * fails, or no proxies are configured at all, falls through to a direct
 * request - the same thing this function has always done - so a proxy
 * outage degrades to "no proxy" rather than ever blocking a price lookup.
 */
async function curlGetJson(url) {
  const pool = await getActiveProxyPool().catch(() => []);
  if (pool.length === 0) return runCurl(url, null);

  const attempts = Math.min(pool.length, MAX_PROXY_ATTEMPTS_PER_CALL);
  for (let i = 0; i < attempts; i++) {
    const proxy = pool[proxyRoundRobinIndex % pool.length];
    proxyRoundRobinIndex++;
    try {
      const result = await runCurl(url, proxy.url);
      recordProxyResult(proxy._id, true).catch(() => {}); // fire-and-forget - never let bookkeeping slow down the actual response
      return result;
    } catch (err) {
      recordProxyResult(proxy._id, false, err.message).catch(() => {});
    }
  }
  // Every proxy tried for this call failed - this IS the request the caller
  // is waiting on, so it's awaited normally, errors and all.
  return runCurl(url, null);
}

/** Raw coin info from pump.fun's own API (market cap, reserves, decimals, ...). */
export async function getCoinInfo(mint) {
  const cached = cache.get(mint);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existingRequest = inflight.get(mint);
  if (existingRequest) return existingRequest; // another caller already has this exact lookup in progress - share it, don't duplicate it

  const request = (async () => {
    const base = process.env.PUMP_FUN_API_BASE || "https://frontend-api-v3.pump.fun";
    const { status, body } = await curlGetJson(`${base}/coins-v3/${mint}`);

    if (status === 404) {
      cache.set(mint, { data: null, expiresAt: Date.now() + CACHE_TTL_MS });
      return null;
    }
    if (status !== 200) throw new Error(`pump.fun API HTTP ${status} for ${mint}`);

    const data = JSON.parse(body);
    cache.set(mint, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  })();

  inflight.set(mint, request);
  try {
    return await request;
  } finally {
    inflight.delete(mint); // always clear it, success or failure, so a failed lookup doesn't wedge future calls for this mint
  }
}

/** Derives a per-token price from a coin's reserves/market-cap, the same way the bonding curve prices trades. */
export function priceFromCoinInfo(coin) {
  if (!coin) return null;
  const baseDecimals = coin.base_decimals ?? 6;
  const quoteDecimals = coin.quote_decimals ?? 9;

  const priceInQuote =
    coin.virtual_sol_reserves && coin.virtual_token_reserves
      ? coin.virtual_sol_reserves / 10 ** quoteDecimals / (coin.virtual_token_reserves / 10 ** baseDecimals)
      : null;

  const priceUsd =
    coin.usd_market_cap && coin.total_supply ? coin.usd_market_cap / (coin.total_supply / 10 ** baseDecimals) : null;

  return {
    priceInQuote,
    priceUsd,
    isNativeSolQuote: coin.quote_mint === SYSTEM_PROGRAM_ID,
    marketCapUsd: coin.usd_market_cap ?? null,
  };
}

/**
 * Marks a list of holdings (from db/positionLedger.js's getHoldings) to
 * current market price/value using pump.fun's own coin data.
 */
export async function markHoldings(holdings) {
  const results = [];
  for (const holding of holdings) {
    const coin = await getCoinInfo(holding.mint).catch(() => null);
    const price = priceFromCoinInfo(coin);
    const currentValueUsd = price?.priceUsd != null ? price.priceUsd * holding.tokenAmount : null;
    results.push({
      ...holding,
      symbol: coin?.symbol ?? null,
      name: coin?.name ?? null,
      priceUsd: price?.priceUsd ?? null,
      currentValueUsd,
    });
  }
  return results;
}
