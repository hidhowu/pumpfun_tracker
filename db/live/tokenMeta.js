import { getCoinInfo } from "../pumpFunApi.js";

/**
 * Name / symbol / logo for token mints. These never change, so they are cached for the life of the process.
 * Jupiter's token index first (one request covers up to 100 mints), pump.fun's own API for fresh pump tokens
 * Jupiter has not indexed yet. A mint nobody knows is retried after a minute.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

const known = new Map(); // mint -> { symbol, name, icon }
const missing = new Map(); // mint -> retry-after timestamp
const MISSING_RETRY_MS = 60_000;

async function fromJupiter(mints) {
  for (let i = 0; i < mints.length; i += 100) {
    const chunk = mints.slice(i, i + 100);
    try {
      const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${chunk.join(",")}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      for (const t of await res.json()) {
        if (chunk.includes(t.id)) known.set(t.id, { symbol: t.symbol ?? null, name: t.name ?? null, icon: t.icon ?? null });
      }
    } catch {
      // fall through to pump.fun for whatever is still unknown
    }
  }
}

/** @returns {Promise<Map<string, {symbol: string|null, name: string|null, icon: string|null}>>} only mints that were found */
export async function getTokenMeta(mints) {
  const wanted = [...new Set(mints)];
  const need = wanted.filter((m) => !known.has(m) && (missing.get(m) ?? 0) <= Date.now());
  if (need.length) {
    await fromJupiter(need);
    const stillUnknown = need.filter((m) => !known.has(m));
    await Promise.all(
      stillUnknown.slice(0, 20).map(async (mint) => {
        const coin = await getCoinInfo(mint).catch(() => null);
        if (coin?.symbol) known.set(mint, { symbol: coin.symbol, name: coin.name ?? null, icon: coin.image_uri ?? null });
      })
    );
    for (const m of need) if (!known.has(m)) missing.set(m, Date.now() + MISSING_RETRY_MS);
  }
  return new Map(wanted.filter((m) => known.has(m)).map((m) => [m, known.get(m)]));
}
