import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import pumpIdl from "../idl/pump.json" with { type: "json" };
import pumpAmmIdl from "../idl/pump_amm.json" with { type: "json" };
import { HttpRpcEndpoint } from "./models/HttpRpcEndpoint.js";

/**
 * Live token prices read straight from the chain - no pump.fun website API,
 * no proxies, no Cloudflare.
 *
 * Where a pump.fun token's price lives depends on whether it has graduated:
 *
 *  1. Still on the bonding curve: the BondingCurve account at PDA
 *     ["bonding-curve", mint] (pump program) holds virtual_quote_reserves /
 *     virtual_token_reserves - the exact reserves the curve prices the next
 *     trade from. price = virtual_quote / virtual_token.
 *  2. Graduated: the same BondingCurve account still exists with
 *     `complete: true` - that flag is how we know. Liquidity then lives in
 *     the canonical PumpSwap (pump AMM) pool at PDA
 *     ["pool", u16 0, pool_authority, mint, wSOL] (pump AMM program), where
 *     pool_authority = ["pool-authority", mint] (pump program) - the exact
 *     PDAs pump's own `migrate` instruction uses (idl/pump.json). The price
 *     is (quote vault balance + pool.virtual_quote_reserves) / base vault
 *     balance. The virtual_quote_reserves term matters: without it the
 *     price came out ~5x too low against Jupiter on real graduated tokens.
 *
 * Every lookup reads the curve first, so a token that graduates WHILE we
 * hold it is priced from its pool on the very next lookup. `complete` never
 * flips back, so once graduated a mint skips the curve read from then on.
 *
 * Many mints are priced with one getMultipleAccounts call (up to 100
 * accounts each): callers within a ~20ms window are micro-batched together,
 * so a whole risk sweep costs one or two RPC calls, not one per token.
 *
 * SOL-quoted prices are converted with SOL/USD from Jupiter's price API.
 * Returns null for a mint it can't price (e.g. migrated somewhere other
 * than PumpSwap) - db/pumpFunApi.js then falls back to pump.fun's API.
 */

const PUMP_PROGRAM = new PublicKey(pumpIdl.address);
const PUMP_AMM_PROGRAM = new PublicKey(pumpAmmIdl.address);
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_PUBKEY = "11111111111111111111111111111111"; // an unset quote_mint means native SOL
const USD_STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);
const QUOTE_DECIMALS = { [WSOL_MINT]: 9, [DEFAULT_PUBKEY]: 9, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6 };

const pumpCoder = new BorshAccountsCoder(pumpIdl);
const ammCoder = new BorshAccountsCoder(pumpAmmIdl);

// Per-mint facts that never change once learned: token decimals, whether it
// graduated, and its pool's addresses.
const mintFacts = new Map(); // mint -> { decimals?, graduated?, pool?, baseVault?, quoteVault? }
const facts = (mint) => {
  if (!mintFacts.has(mint)) mintFacts.set(mint, {});
  return mintFacts.get(mint);
};

const curvePda = (mint) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0].toBase58();
function poolPda(mint) {
  const mintKey = new PublicKey(mint);
  const authority = PublicKey.findProgramAddressSync([Buffer.from("pool-authority"), mintKey.toBuffer()], PUMP_PROGRAM)[0];
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), Buffer.from([0, 0]), authority.toBuffer(), mintKey.toBuffer(), new PublicKey(WSOL_MINT).toBuffer()],
    PUMP_AMM_PROGRAM
  )[0].toBase58();
}

// ------------------------------------------------------------------- RPC

const RPC_TIMEOUT_MS = 6000;
let rpcIndex = 0;
let dbRpcCache = { urls: [], expiresAt: 0 };

/** .env SOLANA_RPC_URLS plus every enabled HTTP endpoint from the /rpc page - same pool the tracker daemon uses. */
async function rpcUrls() {
  if (dbRpcCache.expiresAt < Date.now()) {
    const enabled = await HttpRpcEndpoint.find({ enabled: true }, { url: 1 }).lean().catch(() => []);
    dbRpcCache = { urls: enabled.map((e) => e.url), expiresAt: Date.now() + 30_000 };
  }
  const envUrls = (process.env.SOLANA_RPC_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const all = [...new Set([...dbRpcCache.urls, ...envUrls])];
  return all.length ? all : ["https://api.mainnet-beta.solana.com"];
}

/** JSON-RPC call, rotating endpoints and failing over to the next one on any error. */
async function rpc(method, params) {
  const urls = await rpcUrls();
  let lastErr;
  for (let i = 0; i < Math.min(3, urls.length); i++) {
    const url = urls[rpcIndex++ % urls.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      const body = await res.json();
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** address -> Buffer|null, 100 accounts per call, "processed" for the freshest state. */
async function getAccounts(addresses) {
  const out = new Map();
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const result = await rpc("getMultipleAccounts", [chunk, { encoding: "base64", commitment: "processed" }]);
    result.value.forEach((acc, idx) => out.set(chunk[idx], acc ? Buffer.from(acc.data[0], "base64") : null));
  }
  return out;
}

const tokenAmount = (data) => Number(data.readBigUInt64LE(64)); // SPL Token / Token-2022 account: amount at byte 64
const mintDecimals = (data) => data[44]; // SPL Token / Token-2022 mint: decimals at byte 44

// -------------------------------------------------------------- SOL/USD

let solUsd = { value: null, fetchedAt: 0 };

/** SOL/USD from Jupiter's price API. `maxAgeMs: 0` forces a fresh request. Keeps the last good value if a refresh fails. */
export async function getSolUsd({ maxAgeMs = 10_000 } = {}) {
  if (solUsd.value && Date.now() - solUsd.fetchedAt <= maxAgeMs) return solUsd.value;
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${WSOL_MINT}`, { signal: AbortSignal.timeout(5000) });
    const price = (await res.json())?.[WSOL_MINT]?.usdPrice;
    if (Number.isFinite(price) && price > 0) solUsd = { value: price, fetchedAt: Date.now() };
  } catch {
    // keep the last good value below
  }
  return solUsd.value;
}

function quoteToUsd(quoteMint, solPrice) {
  if (quoteMint === WSOL_MINT || quoteMint === DEFAULT_PUBKEY) return solPrice;
  if (USD_STABLES.has(quoteMint)) return 1;
  return null; // some other quote token - not priced here
}

// --------------------------------------------------------------- pricing

/**
 * Prices many mints from the chain in as few RPC calls as possible.
 * `freshSol` forces a fresh SOL/USD read too (fills).
 * @returns {Promise<Map<string, {priceUsd, priceInQuote, quoteMint, source, graduated} | null>>}
 */
async function priceBatch(mints, { freshSol = false } = {}) {
  const result = new Map(mints.map((m) => [m, null]));
  const solPromise = getSolUsd({ maxAgeMs: freshSol ? 0 : 10_000 });

  // Round 1: the curve for every mint not already known to have graduated,
  // plus the mint account wherever decimals aren't known yet.
  const round1 = new Set();
  for (const mint of mints) {
    if (!facts(mint).graduated) round1.add(curvePda(mint));
    if (facts(mint).decimals === undefined) round1.add(mint);
  }
  const acc1 = round1.size ? await getAccounts([...round1]) : new Map();

  const curvePriced = [];
  const graduated = [];
  for (const mint of mints) {
    const f = facts(mint);
    const mintData = acc1.get(mint);
    if (mintData) f.decimals = mintDecimals(mintData);
    if (f.graduated) {
      graduated.push(mint);
      continue;
    }
    const curveData = acc1.get(curvePda(mint));
    const curve = curveData ? safeDecode(pumpCoder, "BondingCurve", curveData) : null;
    if (curve && !curve.complete) curvePriced.push([mint, curve]);
    else {
      if (curve?.complete) f.graduated = true;
      graduated.push(mint); // complete, or no curve at all - try the PumpSwap pool
    }
  }

  // Round 2 (graduated only): pool account + its two vaults. The vault
  // addresses come from the pool account, so a never-seen pool costs one
  // extra round to learn them; after that they're remembered.
  const pools = new Map();
  if (graduated.length) {
    const unknown = graduated.filter((m) => !facts(m).baseVault);
    if (unknown.length) {
      const poolAccs = await getAccounts(unknown.map(poolPda));
      for (const mint of unknown) {
        const data = poolAccs.get(poolPda(mint));
        const pool = data ? safeDecode(ammCoder, "Pool", data) : null;
        if (!pool) continue;
        Object.assign(facts(mint), {
          pool: poolPda(mint),
          baseVault: pool.pool_base_token_account.toBase58(),
          quoteVault: pool.pool_quote_token_account.toBase58(),
        });
      }
    }
    const ready = graduated.filter((m) => facts(m).baseVault);
    const acc2 = ready.length ? await getAccounts(ready.flatMap((m) => [facts(m).pool, facts(m).baseVault, facts(m).quoteVault])) : new Map();
    for (const mint of ready) {
      const f = facts(mint);
      const poolData = acc2.get(f.pool);
      const pool = poolData ? safeDecode(ammCoder, "Pool", poolData) : null;
      const base = acc2.get(f.baseVault);
      const quote = acc2.get(f.quoteVault);
      if (pool && base && quote) pools.set(mint, { pool, base: tokenAmount(base), quote: tokenAmount(quote) });
    }
  }

  const sol = await solPromise;
  for (const [mint, curve] of curvePriced) {
    const quoteMint = curve.quote_mint?.toBase58?.() ?? DEFAULT_PUBKEY;
    const qDec = QUOTE_DECIMALS[quoteMint];
    const usdPerQuote = quoteToUsd(quoteMint, sol);
    const dec = facts(mint).decimals ?? 6;
    const vToken = Number(curve.virtual_token_reserves);
    if (qDec === undefined || !usdPerQuote || !vToken) continue;
    const priceInQuote = Number(curve.virtual_quote_reserves) / 10 ** qDec / (vToken / 10 ** dec);
    result.set(mint, { priceUsd: priceInQuote * usdPerQuote, priceInQuote, quoteMint, source: "bonding_curve", graduated: false });
  }
  for (const [mint, { pool, base, quote }] of pools) {
    const quoteMint = pool.quote_mint.toBase58();
    const qDec = QUOTE_DECIMALS[quoteMint];
    const usdPerQuote = quoteToUsd(quoteMint, sol);
    const dec = facts(mint).decimals ?? 6;
    if (qDec === undefined || !usdPerQuote || !base) continue;
    const quoteReserves = quote + Number(pool.virtual_quote_reserves ?? 0);
    const priceInQuote = quoteReserves / 10 ** qDec / (base / 10 ** dec);
    result.set(mint, { priceUsd: priceInQuote * usdPerQuote, priceInQuote, quoteMint, source: "pump_amm", graduated: true });
  }
  return result;
}

function safeDecode(coder, name, data) {
  try {
    return coder.decode(name, data);
  } catch {
    return null; // not this account type (e.g. some other program owns the address)
  }
}

// ----------------------------------------------------------- micro-batch

const BATCH_WINDOW_MS = 20;
let pending = null; // { mints: Map<mint, resolver[]>, freshSol, timer }

/**
 * On-chain price for one mint, or null. Calls made within ~20ms of each
 * other share ONE batched RPC round-trip. Never cached here - every call is
 * a real read made at or after the moment it was requested, which is what
 * fills rely on (db/pumpFunApi.js layers the display/risk cache on top).
 */
export function getOnchainPrice(mint, { freshSol = false } = {}) {
  return new Promise((resolve) => {
    if (!pending) {
      pending = { mints: new Map(), freshSol: false, timer: setTimeout(flush, BATCH_WINDOW_MS) };
    }
    if (!pending.mints.has(mint)) pending.mints.set(mint, []);
    pending.mints.get(mint).push(resolve);
    if (freshSol) pending.freshSol = true;
  });
}

async function flush() {
  const batch = pending;
  pending = null;
  const mints = [...batch.mints.keys()];
  let prices;
  try {
    prices = await priceBatch(mints, { freshSol: batch.freshSol });
  } catch {
    prices = new Map(); // RPC down - every caller gets null and falls back
  }
  for (const [mint, resolvers] of batch.mints) {
    for (const resolve of resolvers) resolve(prices.get(mint) ?? null);
  }
}
