/**
 * DexScreener's public token endpoint: name, symbol, logo and a USD price for any token that trades in at least one pool
 * (pump.fun, PumpSwap, Raydium, Meteora ...). Used for tokens the app's own on-chain reads can't price or name, and for SOL's own USD price.
 * One request covers up to 30 mints. Results are cached for a few seconds so polling pages don't hammer it. Requests go through the
 * proxy pool (db/proxiedCurl.js) so a burst from this machine doesn't get its single IP rate-limited.
 */

import { curlGetJson } from "../proxiedCurl.js";

const CACHE_MS = 15_000;
const MAX_PER_REQUEST = 30;
// A pool this thin gives a meaningless price (a rugged token's last trade, say) - better to show "no price" than a made-up value.
const MIN_LIQUIDITY_USD = 100;

const cache = new Map(); // mint -> { at, value }

const WSOL_MINT = "So11111111111111111111111111111111111111112";
// The dollar-pegged tokens a SOL pair can be quoted in (USDC, USDT) - a pair quoted in these gives SOL's USD price directly.
const USD_QUOTES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
// A SOL pair thinner than this is ignored however busy it is - a tiny pool is the easiest one to push around.
const MIN_SOL_PAIR_LIQUIDITY_USD = 10_000;
let solCache = null; // { at, value }

/**
 * SOL's USD price, from the busiest SOL/USDC or SOL/USDT pair DexScreener lists: the one with the most transactions in the last 24 hours
 * (ties and missing counts fall back to liquidity), so the price comes from where SOL actually trades most. DexScreener's rate limit is
 * generous next to Jupiter's price API, which is why SOL is priced here. `maxAgeMs: 0` forces a fresh request. Returns null when
 * DexScreener can't be reached or has no usable pair - the caller keeps its last good value.
 * @returns {Promise<number|null>}
 */
export async function getSolUsdFromDexScreener({ maxAgeMs = CACHE_MS } = {}) {
  if (solCache && Date.now() - solCache.at < maxAgeMs) return solCache.value;
  let pairs;
  try {
    const { status, body } = await curlGetJson(`https://api.dexscreener.com/latest/dex/tokens/${WSOL_MINT}`, { timeoutSec: 6 });
    if (status !== 200) return null;
    pairs = JSON.parse(body)?.pairs;
  } catch {
    return null;
  }
  if (!Array.isArray(pairs)) return null;

  const txns = (p) => (Number(p.txns?.h24?.buys) || 0) + (Number(p.txns?.h24?.sells) || 0);
  const usable = pairs.filter(
    (p) =>
      p?.chainId === "solana" &&
      p.baseToken?.address === WSOL_MINT &&
      USD_QUOTES.has(p.quoteToken?.address) &&
      (Number(p.liquidity?.usd) || 0) >= MIN_SOL_PAIR_LIQUIDITY_USD &&
      Number(p.priceUsd) > 0
  );
  if (!usable.length) return null;
  const best = usable.reduce((a, b) => (txns(b) > txns(a) || (txns(b) === txns(a) && (Number(b.liquidity?.usd) || 0) > (Number(a.liquidity?.usd) || 0)) ? b : a));
  const price = Number(best.priceUsd);
  solCache = { at: Date.now(), value: price };
  return price;
}

/**
 * `maxAgeMs` caps how old a cached reading may be (default CACHE_MS); 0 forces a fresh request.
 * @returns {Promise<Map<string, { name: string|null, symbol: string|null, icon: string|null, priceUsd: number|null }>>}
 *   only mints DexScreener knows. priceUsd is null when the best pool has too little liquidity to trust.
 */
export async function getDexScreenerTokens(mints, { maxAgeMs = CACHE_MS } = {}) {
  const out = new Map();
  const need = [];
  for (const mint of new Set(mints)) {
    const hit = cache.get(mint);
    if (hit && Date.now() - hit.at < maxAgeMs) {
      if (hit.value) out.set(mint, hit.value);
    } else need.push(mint);
  }

  for (let i = 0; i < need.length; i += MAX_PER_REQUEST) {
    const chunk = need.slice(i, i + MAX_PER_REQUEST);
    let pairs;
    try {
      const { status, body } = await curlGetJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, { timeoutSec: 6 });
      if (status !== 200) continue;
      pairs = JSON.parse(body);
    } catch {
      continue; // leave these uncached so the next call retries
    }
    if (!Array.isArray(pairs)) continue;

    const best = new Map(); // mint -> the pool with the most liquidity where the mint is the base token
    for (const p of pairs) {
      const mint = p?.baseToken?.address;
      if (!mint || !chunk.includes(mint)) continue;
      const liquidity = Number(p.liquidity?.usd) || 0;
      const current = best.get(mint);
      if (!current || liquidity > current.liquidity) best.set(mint, { pair: p, liquidity });
    }
    for (const mint of chunk) {
      const found = best.get(mint);
      let value = null;
      if (found) {
        const price = Number(found.pair.priceUsd);
        value = {
          name: found.pair.baseToken.name ?? null,
          symbol: found.pair.baseToken.symbol ?? null,
          icon: typeof found.pair.info?.imageUrl === "string" && found.pair.info.imageUrl.startsWith("https://") ? found.pair.info.imageUrl : null,
          priceUsd: Number.isFinite(price) && price > 0 && found.liquidity >= MIN_LIQUIDITY_USD ? price : null,
        };
      }
      cache.set(mint, { at: Date.now(), value });
      if (value) out.set(mint, value);
    }
  }
  return out;
}
