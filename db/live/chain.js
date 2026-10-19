import { rpc, getOnchainPrice, getSolUsd } from "../onchainPrice.js";
import { getTokenMeta, WSOL_MINT } from "./tokenMeta.js";
import { getDexScreenerTokens } from "./dexscreener.js";

/**
 * What a live wallet holds right now, read straight from the chain: SOL, every token account (classic SPL Token and
 * Token-2022), and a USD price for each token that has one. Token prices come from the same on-chain reads the rest of
 * the app uses (bonding curve / PumpSwap pool); Jupiter's price API covers tokens those can't price (USDC, other DEXes),
 * and DexScreener covers whatever is left that trades in a pool with real liquidity. A token with no live market stays unpriced.
 */

const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // SPL Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
];
const LAMPORTS_PER_SOL = 1_000_000_000;
const CACHE_MS = 8_000;

const cache = new Map(); // address -> { at, promise }

async function tokenAccountsOf(address, programId) {
  const result = await rpc("getTokenAccountsByOwner", [address, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  return result.value.map(({ pubkey, account }) => {
    const info = account.data.parsed.info;
    return {
      account: pubkey,
      mint: info.mint,
      program: programId === TOKEN_PROGRAMS[0] ? "spl-token" : "token-2022",
      balance: Number(info.tokenAmount.uiAmountString),
      rawAmount: info.tokenAmount.amount,
      decimals: info.tokenAmount.decimals,
      state: info.state, // initialized | frozen
      rentLamports: account.lamports,
    };
  });
}

async function jupiterPrices(mints) {
  const out = new Map();
  for (let i = 0; i < mints.length; i += 50) {
    const chunk = mints.slice(i, i + 50);
    try {
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${chunk.join(",")}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const body = await res.json();
      for (const mint of chunk) if (Number.isFinite(body?.[mint]?.usdPrice)) out.set(mint, body[mint].usdPrice);
    } catch {
      // unpriced tokens just show no value
    }
  }
  return out;
}

async function load(address) {
  const [lamports, accountLists, solUsd] = await Promise.all([
    rpc("getBalance", [address, { commitment: "confirmed" }]),
    Promise.all(TOKEN_PROGRAMS.map((p) => tokenAccountsOf(address, p))),
    getSolUsd(),
  ]);
  const accounts = accountLists.flat();
  const solBalance = lamports.value / LAMPORTS_PER_SOL;

  const heldMints = [...new Set(accounts.filter((a) => a.balance > 0).map((a) => a.mint))];
  const prices = new Map();
  await Promise.all(
    heldMints.map(async (mint) => {
      if (mint === WSOL_MINT) return void (solUsd && prices.set(mint, solUsd));
      const p = await getOnchainPrice(mint).catch(() => null);
      if (p?.priceUsd > 0) prices.set(mint, p.priceUsd);
    })
  );
  const unpriced = heldMints.filter((m) => !prices.has(m));
  if (unpriced.length) for (const [mint, price] of await jupiterPrices(unpriced)) prices.set(mint, price);
  const stillUnpriced = heldMints.filter((m) => !prices.has(m));
  if (stillUnpriced.length) for (const [mint, t] of await getDexScreenerTokens(stillUnpriced)) if (t.priceUsd) prices.set(mint, t.priceUsd);

  const meta = await getTokenMeta([...new Set(accounts.map((a) => a.mint))]);

  const byMint = new Map();
  for (const a of accounts) {
    const row = byMint.get(a.mint) ?? { mint: a.mint, decimals: a.decimals, balance: 0, accounts: 0 };
    row.balance += a.balance;
    row.accounts += 1;
    byMint.set(a.mint, row);
  }
  const tokens = [...byMint.values()]
    .filter((t) => t.balance > 0)
    .map((t) => {
      const priceUsd = prices.get(t.mint) ?? null;
      const m = meta.get(t.mint);
      return { ...t, symbol: m?.symbol ?? null, name: m?.name ?? null, icon: m?.icon ?? null, priceUsd, valueUsd: priceUsd === null ? null : priceUsd * t.balance };
    })
    .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  const tokenAccounts = accounts
    .map((a) => ({ ...a, symbol: meta.get(a.mint)?.symbol ?? null, name: meta.get(a.mint)?.name ?? null, icon: meta.get(a.mint)?.icon ?? null }))
    .sort((a, b) => b.balance - a.balance);

  const solValueUsd = solUsd ? solBalance * solUsd : null;
  const tokensValueUsd = tokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0);
  return {
    address,
    solBalance,
    solUsd: solUsd ?? null,
    solValueUsd,
    tokensValueUsd,
    totalValueUsd: solValueUsd === null ? null : solValueUsd + tokensValueUsd,
    tokens,
    accounts: tokenAccounts,
    fetchedAt: Date.now(),
  };
}

/** The wallet's holdings, cached for a few seconds so a page polling every 10s (or a list of wallets) doesn't hammer the RPC. */
export function getChainSnapshot(address, { fresh = false } = {}) {
  const hit = cache.get(address);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = load(address);
  cache.set(address, { at: Date.now(), promise });
  promise.catch(() => cache.delete(address)); // never cache a failure
  return promise;
}
