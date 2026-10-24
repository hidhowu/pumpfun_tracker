import { curlGetJson } from "./proxiedCurl.js";
import { getOnchainPrice } from "./onchainPrice.js";

// A risk-check tick will re-sample a stale-but-not-yet-expired price rather
// than fire a fresh call for it - intentional trade-off, since an outbound
// curl call per distinct open mint every tick is what was overwhelming the
// proxy pool/pump.fun's rate limiting in the first place. A successful
// lookup always overwrites this entry immediately regardless of age (see
// getCoinInfo below), so a mint never actually waits the full 60s once a
// newer real price comes in - this TTL only bounds how long a price can go
// un-refreshed if nothing else happens to re-fetch it sooner.
const CACHE_TTL_MS = 60_000;
const cache = new Map(); // mint -> { data, expiresAt, fetchedAt }

// How old a cached price a MONITORING caller will accept - see getPrice.
// Fills never use these: they pass { fresh: true } and always get a brand
// new read taken after the execution delay.
//  - RISK_SWEEP: stop-loss/take-profit/trailing/peak tracking. Must be at
//    least as frequent as the sweep, or short spikes are missed (a 60s cache
//    is why a position could show +58% live with a recorded peak of +10%).
//  - DEFAULT: dashboard views, dust checks, snapshots.
export const PRICE_MAX_AGE = { RISK_SWEEP: 5_000, DEFAULT: 10_000 };

/**
 * Drops every cache entry whose TTL has already passed. Without this, a
 * mint that's only ever looked up while it has an open position (every
 * caller in this module is scoped to open positions/holdings - see
 * prefetchPrices below) would sit in this Map forever once that position
 * closes and nothing ever reads it again - the expiresAt check on read only
 * ignores stale data, it doesn't remove it, so the Map would otherwise grow
 * for as long as the daemon process stays up. Safe to call anytime: a mint
 * that's still actively needed gets re-fetched and re-added right after
 * being pruned (see prefetchPrices, which calls this right before
 * re-populating the mints it was just asked for).
 */
function pruneExpiredCache() {
  const now = Date.now();
  for (const [mint, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(mint);
  }
}
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

/**
 * Raw coin info from pump.fun's own API (market cap, reserves, decimals, ...).
 * `maxAgeMs` (see PRICE_MAX_AGE) caps how old a cached reading may be for
 * this caller; an older one triggers a fresh request.
 */
export async function getCoinInfo(mint, { maxAgeMs = CACHE_TTL_MS, fresh = false } = {}) {
  const cached = cache.get(mint);
  if (!fresh && cached && cached.expiresAt > Date.now() && Date.now() - cached.fetchedAt <= maxAgeMs) return cached.data;

  // A fresh read must not piggyback on a request that started before it was asked for.
  const existingRequest = fresh ? null : inflight.get(mint);
  if (existingRequest) return existingRequest; // another caller already has this exact lookup in progress - share it, don't duplicate it

  const request = (async () => {
    const base = process.env.PUMP_FUN_API_BASE || "https://frontend-api-v3.pump.fun";
    const { status, body } = await curlGetJson(`${base}/coins-v3/${mint}`);

    if (status === 404) {
      cache.set(mint, { data: null, expiresAt: Date.now() + CACHE_TTL_MS, fetchedAt: Date.now() });
      return null;
    }
    if (status !== 200) throw new Error(`pump.fun API HTTP ${status} for ${mint}`);

    const data = JSON.parse(body);
    cache.set(mint, { data, expiresAt: Date.now() + CACHE_TTL_MS, fetchedAt: Date.now() });
    return data;
  })();

  if (fresh) return request;
  inflight.set(mint, request);
  try {
    return await request;
  } finally {
    inflight.delete(mint); // always clear it, success or failure, so a failed lookup doesn't wedge future calls for this mint
  }
}

// ------------------------------------------------------------- getPrice

const priceCache = new Map(); // mint -> { price, fetchedAt } - monitoring reads only

/**
 * THE way to price a token. Reads the chain (db/onchainPrice.js: bonding
 * curve, or the PumpSwap pool once graduated); falls back to pump.fun's
 * API only if the chain read can't price it. Never throws - null means no
 * price could be found.
 *
 *  - { fresh: true } - for FILLS. Always a brand-new read (token AND SOL/USD)
 *    started now; no cache, no sharing an in-flight request. A simulated
 *    buy/sell fills at the price that exists when its execution delay ends.
 *  - { maxAgeMs } - for MONITORING (views, P&L, stop-loss/take-profit). A
 *    cached reading up to maxAgeMs old is fine and saves RPC calls.
 *
 * @returns {Promise<{priceUsd: number, priceInQuote: number|null, quoteMint?: string, source: string, graduated?: boolean, fetchedAt: number} | null>}
 */
export async function getPrice(mint, { fresh = false, maxAgeMs = PRICE_MAX_AGE.DEFAULT } = {}) {
  if (!fresh) {
    const cached = priceCache.get(mint);
    if (cached && Date.now() - cached.fetchedAt <= maxAgeMs) return cached.price;
  }

  let price = await getOnchainPrice(mint, { freshSol: fresh }).catch(() => null);
  if (!price?.priceUsd) {
    const fallback = priceFromCoinInfo(await getCoinInfo(mint, { fresh, maxAgeMs }).catch(() => null));
    price = fallback?.priceUsd ? { ...fallback, source: "pump_api" } : null;
  }
  if (!price) return null;

  const stamped = { ...price, fetchedAt: Date.now() };
  priceCache.set(mint, { price: stamped, fetchedAt: stamped.fetchedAt });
  return stamped;
}

/**
 * Warms the price cache for many mints at once - e.g. every open position
 * before a risk sweep. All of them go through getPrice in the same tick, so
 * db/onchainPrice.js batches them into one getMultipleAccounts round (up to
 * 100 accounts per call) instead of one request per mint. Also prunes the
 * pump.fun API cache, which only the fallback path still fills.
 */
export async function prefetchPrices(mints, { maxAgeMs = PRICE_MAX_AGE.DEFAULT } = {}) {
  pruneExpiredCache();
  for (const [mint, entry] of priceCache) {
    if (Date.now() - entry.fetchedAt > 10 * 60_000) priceCache.delete(mint); // closed positions' mints - see pruneExpiredCache
  }
  await Promise.all([...new Set(mints)].map((mint) => getPrice(mint, { maxAgeMs })));
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
