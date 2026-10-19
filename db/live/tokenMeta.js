import { getCoinInfo } from "../pumpFunApi.js";
import { getDexScreenerTokens } from "./dexscreener.js";
import { getOnchainTokenMeta } from "./onchainMeta.js";

/**
 * Name / symbol / logo for token mints. These never change, so they are cached for the life of the process.
 * Sources, in order, each only for what the previous ones couldn't name:
 *  1. Jupiter's token index (one request covers up to 100 mints);
 *  2. pump.fun's own API (fresh pump tokens Jupiter hasn't indexed);
 *  3. DexScreener (any token that trades in a pool; also gives the logo);
 *  4. the token's own on-chain metadata - what Solflare and the Telegram bots read - which works even for a token with no pool.
 * Tokens that come back with a name but no logo get one more try at the logo from DexScreener / the chain.
 * A mint nobody knows is retried after a minute.
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

const known = new Map(); // mint -> { symbol, name, icon }
const missing = new Map(); // mint -> retry-after timestamp
const iconTried = new Set(); // mints already given their one extra try at finding a logo
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

async function fromDexScreener(mints) {
  for (const [mint, t] of await getDexScreenerTokens(mints)) {
    if (t.symbol || t.name) known.set(mint, { symbol: t.symbol, name: t.name, icon: t.icon });
  }
}

async function fromChain(mints) {
  await Promise.all(
    mints.slice(0, 20).map(async (mint) => {
      const meta = await getOnchainTokenMeta(mint).catch(() => null);
      if (meta) known.set(mint, meta);
    })
  );
}

/** A name without a logo: look once more (DexScreener first, then the token's own metadata file) and keep whatever icon turns up. */
async function findMissingIcons(mints) {
  const bare = mints.filter((m) => known.get(m)?.symbol && !known.get(m).icon && !iconTried.has(m)).slice(0, 20);
  if (!bare.length) return;
  for (const m of bare) iconTried.add(m);
  const fromDex = await getDexScreenerTokens(bare);
  const rest = [];
  for (const m of bare) {
    const icon = fromDex.get(m)?.icon;
    if (icon) known.set(m, { ...known.get(m), icon });
    else rest.push(m);
  }
  await Promise.all(
    rest.map(async (m) => {
      const meta = await getOnchainTokenMeta(m).catch(() => null);
      if (meta?.icon) known.set(m, { ...known.get(m), icon: meta.icon });
    })
  );
}

/** @returns {Promise<Map<string, {symbol: string|null, name: string|null, icon: string|null}>>} only mints that were found */
export async function getTokenMeta(mints) {
  const wanted = [...new Set(mints)];
  const need = wanted.filter((m) => !known.has(m) && (missing.get(m) ?? 0) <= Date.now());
  if (need.length) {
    await fromJupiter(need);
    const afterJupiter = need.filter((m) => !known.has(m));
    await Promise.all(
      afterJupiter.slice(0, 20).map(async (mint) => {
        const coin = await getCoinInfo(mint).catch(() => null);
        if (coin?.symbol) known.set(mint, { symbol: coin.symbol, name: coin.name ?? null, icon: coin.image_uri ?? null });
      })
    );
    const afterPump = need.filter((m) => !known.has(m));
    if (afterPump.length) await fromDexScreener(afterPump);
    const afterDex = need.filter((m) => !known.has(m));
    if (afterDex.length) await fromChain(afterDex);
    for (const m of need) if (!known.has(m)) missing.set(m, Date.now() + MISSING_RETRY_MS);
  }
  await findMissingIcons(wanted);
  return new Map(wanted.filter((m) => known.has(m)).map((m) => [m, known.get(m)]));
}
