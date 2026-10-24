/**
 * DexScreener's public token endpoint: name, symbol, logo and a USD price for any token that trades in at least one pool
 * (pump.fun, PumpSwap, Raydium, Meteora ...). Used for tokens the app's own on-chain reads and Jupiter can't price or name.
 * One request covers up to 30 mints. Results are cached for a few seconds so polling pages don't hammer it. Requests go through the
 * proxy pool (db/proxiedCurl.js) so a burst from this machine doesn't get its single IP rate-limited.
 */

import { curlGetJson } from "../proxiedCurl.js";

const CACHE_MS = 15_000;
const MAX_PER_REQUEST = 30;
// A pool this thin gives a meaningless price (a rugged token's last trade, say) - better to show "no price" than a made-up value.
const MIN_LIQUIDITY_USD = 100;

const cache = new Map(); // mint -> { at, value }

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
