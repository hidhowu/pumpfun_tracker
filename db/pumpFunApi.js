import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 15_000;
const cache = new Map(); // mint -> { data, expiresAt }
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

const STATUS_MARKER = "\n__HTTP_STATUS__";

/**
 * pump.fun's frontend API blocks Node's own `fetch` (undici) outright -
 * confirmed by testing: plain `curl` gets HTTP 200 reliably (5/5 attempts,
 * with or without extra headers), while Node's `fetch` gets HTTP 403 every
 * single time even with a browser User-Agent set. That's consistent with
 * TLS/HTTP client fingerprinting (e.g. Cloudflare-style bot protection)
 * rather than a header check, since headers alone didn't change Node's
 * result. Shelling out to curl (present by default on Windows 10+ and any
 * Unix box) is the pragmatic fix, since it demonstrably isn't blocked.
 */
async function curlGetJson(url) {
  const { stdout } = await execFileAsync("curl", ["-s", "-m", "10", "-w", `${STATUS_MARKER}%{http_code}`, url]);
  const markerIndex = stdout.lastIndexOf(STATUS_MARKER);
  const body = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
  const status = markerIndex >= 0 ? Number(stdout.slice(markerIndex + STATUS_MARKER.length).trim()) : 0;
  return { status, body };
}

/** Raw coin info from pump.fun's own API (market cap, reserves, decimals, ...). */
export async function getCoinInfo(mint) {
  const cached = cache.get(mint);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

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
