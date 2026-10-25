import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { getTokenUsd } from "../../onchainPrice.js";
import { curlGetJson } from "../../proxiedCurl.js";
import { pumpSdks } from "./sdk.js";
import { ataOf, TOKEN_PROGRAM, TradeError, WSOL, WSOL_MINT } from "./market.js";
import { big, bn, buildDirectBuy, buildDirectSell } from "./directSwap.js";

/**
 * Trading a token that is quoted in another token (USDC, PUMP, ...) with nothing but SOL in the wallet. The SOL is turned into the quote token
 * INSIDE the trade's own transaction, by the first of these that works (tested with real trades, see extras/buyLatencyTest/buy.mjs):
 *
 *   multihop  pump-amm's multi_hop_swap: ONE instruction does SOL -> quote token -> the token (and the reverse on a sale). Only for a quote token
 *             that is itself a graduated pump.fun coin with a canonical pool against SOL.
 *   pool      an exact-out buy of the quote token on its deepest PumpSwap pool against SOL, then the token's own buy. A sale is the reverse:
 *             the token's own sale for the quote token, then the quote token sold into that pool.
 *   jupiter   (buys only) a Jupiter swap in front of the buy, only if neither of the above exists or works.
 *
 * The routes are found before the clock starts (findSolRoutes), and a route that can't be built is noted and the next one tried. Every route is
 * checked against the quote token's market price, so a thin or mispriced pool is refused instead of quietly costing money.
 */

export const SOL_ROUTES = {
  /** Pool route: ceiling on the SOL spent buying the quote token, as a move against us (1 = 1%). */
  SWAP_SLIPPAGE_PERCENT: 1,
  /** Multi-hop buy: refuse when the simulated tokens out are this much (%) below what the quote token's market price would buy. */
  MULTI_HOP_MAX_SHORTFALL_PERCENT: 6,
  /** Pool buy: refuse when the pool charges this much (%) more for the quote token than its market price. */
  POOL_MAX_PRICE_PREMIUM_PERCENT: 3,
  /** Sales: refuse a route paying this much (%) less SOL than the market price of what is sold. Higher than for buys: an exit has to happen. */
  SELL_MAX_SHORTFALL_PERCENT: 12,
  /** Quote tokens whose SOL pool DexScreener doesn't list (it misses the SOL/USDC one): quote mint -> PumpSwap pool. Checked on chain before use. */
  SOL_POOLS: {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "Gf7sXMoP8iRw4iiXmJ1nq4vxcRycbGXy5RL8a8LnTd3v", // USDC / SOL
    pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: "539m4mVWt6iduB6W8rDGPMarzNCMesuqY5eUTiiYHAgR", // PUMP / SOL
  },
  JUPITER_FALLBACK: true,
  /** Jupiter route: a single-venue route only (multi-venue ones made the transaction too large in testing). */
  JUPITER_DIRECT_ONLY: true,
  /** Jupiter route: venues the swap must not use (Manifest sometimes delivered ~4.7% less than it quoted). */
  JUPITER_EXCLUDE_DEXES: "Manifest",
  JUPITER_MAX_ACCOUNTS: 22,
  /** Compute-unit limit for a trade that swaps first (the priority fee is charged on this limit). */
  COMPUTE_UNITS: 400_000,
  /** Leftover of the quote token after a two-step sale that is kept out of the second swap, so a small price move can't make it fail (%). */
  SELL_SWAP_MARGIN_PERCENT: 1,
};

const LAMPORTS = 1e9;
const ROUTE_NAMES = { multihop: "pump multi-hop swap", pool: "PumpSwap pool", jupiter: "Jupiter swap" };
const tokenAmountAt64 = (data) => (data ? data.readBigUInt64LE(64) : 0n);
const sleepRoute = (list) => list.map((r) => ROUTE_NAMES[r.kind]).join(" > ");

// ------------------------------------------------------------------ finding the routes

const routeCache = new Map(); // quote mint -> { at, promise }
const ROUTE_CACHE_MS = 5 * 60_000;

/** The PumpSwap pool selling `quoteMint` for SOL, or null: SOL_POOLS first (instant), otherwise the most liquid such pair DexScreener lists. */
async function deepestSolPool(quoteMint) {
  const known = SOL_ROUTES.SOL_POOLS[quoteMint.toBase58()];
  if (known) return new PublicKey(known);
  const { status, body } = await curlGetJson(`https://api.dexscreener.com/latest/dex/tokens/${quoteMint.toBase58()}`, { timeoutSec: 6 });
  if (status !== 200) throw new Error(`DexScreener answered HTTP ${status}`);
  const best = (JSON.parse(body)?.pairs || [])
    .filter((p) => p.dexId === "pumpswap" && p.baseToken?.address === quoteMint.toBase58() && p.quoteToken?.address === WSOL_MINT)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  return best ? new PublicKey(best.pairAddress) : null;
}

/**
 * Every way to turn SOL into the quote token inside a trade's own transaction, best first. Remembered for a few minutes per quote token (a lookup
 * already under way is shared, so trades that arrive together for the same quote token don't each wait on DexScreener).
 * @returns {Promise<{ kind: "multihop" | "pool" | "jupiter", poolKey?: PublicKey }[]>}
 */
export function findSolRoutes(conn, quote, { jupiter = true } = {}) {
  const key = `${quote.mint.toBase58()}:${jupiter}`;
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_MS) return hit.promise;
  const { amm } = pumpSdks();
  const promise = (async () => {
    const [canonical, poolKey] = await Promise.all([
      conn.getAccountInfo(amm.canonicalPumpPoolPda(quote.mint, WSOL), "confirmed").catch(() => null),
      deepestSolPool(quote.mint).catch(() => null),
    ]);
    const routes = [...(canonical ? [{ kind: "multihop" }] : []), ...(poolKey ? [{ kind: "pool", poolKey }] : []), ...(jupiter && SOL_ROUTES.JUPITER_FALLBACK ? [{ kind: "jupiter" }] : [])];
    if (!routes.length || !canonical && !poolKey && jupiter) routeCache.delete(key); // nothing solid found: look again next time
    return routes;
  })();
  routeCache.set(key, { at: Date.now(), promise });
  promise.catch(() => routeCache.delete(key));
  return promise;
}

// ------------------------------------------------------------------ Jupiter (buys only)

async function jupiter(path, body) {
  const key = process.env.JUPITER_API_KEY;
  const headers = { ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "x-api-key": key } : {}) };
  const res = await fetch(`${key ? "https://api.jup.ag" : "https://lite-api.jup.ag"}/swap/v1${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 429) throw new Error("Jupiter is rate-limiting this server (HTTP 429) - set JUPITER_API_KEY in .env.");
  if (!res.ok) throw new Error(`Jupiter ${path.split("?")[0]} -> HTTP ${res.status} ${json.error || ""}`.trim());
  return json;
}

const toInstruction = (i) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(i.data, "base64"),
  });

/** A Jupiter swap turning SOL into the quote token (exact-in; the SOL amount is raised if even the worst price would deliver too little). */
async function jupiterSwapToQuote(conn, owner, quote, shortfallRaw, solUsd, quoteUsd) {
  const slippageBps = Math.round(SOL_ROUTES.SWAP_SLIPPAGE_PERCENT * 100);
  const margin = 1 + slippageBps / 10000 + 0.005;
  let lamports = BigInt(Math.ceil((Number(shortfallRaw) / 10 ** quote.decimals) * (quoteUsd / solUsd) * LAMPORTS * margin));
  let q;
  for (let attempt = 0; ; attempt++) {
    q = await jupiter(
      `/quote?inputMint=${WSOL_MINT}&outputMint=${quote.mint.toBase58()}&amount=${lamports}&slippageBps=${slippageBps}&maxAccounts=${SOL_ROUTES.JUPITER_MAX_ACCOUNTS}${SOL_ROUTES.JUPITER_DIRECT_ONLY ? "&onlyDirectRoutes=true" : ""}${SOL_ROUTES.JUPITER_EXCLUDE_DEXES ? `&excludeDexes=${encodeURIComponent(SOL_ROUTES.JUPITER_EXCLUDE_DEXES)}` : ""}`
    );
    const floor = BigInt(q.otherAmountThreshold);
    if (floor >= shortfallRaw) break;
    if (attempt === 1) throw new Error("Jupiter's price keeps coming in under what the buy needs");
    lamports = (lamports * shortfallRaw * 1003n) / (floor * 1000n) + 1n;
  }
  const ixs = await jupiter("/swap-instructions", { quoteResponse: q, userPublicKey: owner.toBase58(), wrapAndUnwrapSol: true });
  const tableKeys = (ixs.addressLookupTableAddresses || []).map((a) => new PublicKey(a));
  const infos = tableKeys.length ? await conn.getMultipleAccountsInfo(tableKeys, "confirmed") : [];
  const lookupTables = infos.map((info, i) => (info ? new AddressLookupTableAccount({ key: tableKeys[i], state: AddressLookupTableAccount.deserialize(info.data) }) : null)).filter(Boolean);
  return {
    // Jupiter's own compute-budget instructions are left out: the compute limit and priority fee are set once for the whole transaction.
    instructions: [...ixs.setupInstructions, ixs.swapInstruction, ...(ixs.cleanupInstruction ? [ixs.cleanupInstruction] : []), ...ixs.otherInstructions].map(toInstruction),
    lookupTables,
    lamports: BigInt(q.inAmount),
    route: (q.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean).join(" + "),
  };
}

// ------------------------------------------------------------------ buying

/** The dollars-to-quote-units conversion for this trade. */
function budgetInQuote(budgetLamports, solUsd, quoteUsd, quote) {
  return BigInt(Math.floor((Number(budgetLamports) / LAMPORTS) * (solUsd / quoteUsd) * 10 ** quote.decimals));
}

async function simulateUnsigned(conn, owner, instructions, accounts) {
  const unsigned = new VersionedTransaction(
    new TransactionMessage({ payerKey: owner, recentBlockhash: PublicKey.default.toBase58(), instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...instructions] }).compileToV0Message()
  );
  return conn.simulateTransaction(unsigned, { sigVerify: false, replaceRecentBlockhash: true, commitment: "processed", accounts: { encoding: "base64", addresses: accounts.map((a) => a.toBase58()) } });
}

function multiHopHops(market, side) {
  const { quote } = market;
  const onCurve = market.venue === "curve";
  const quoteHop = { venue: "pool", baseMint: quote.mint, quoteMint: WSOL, baseTokenProgram: quote.program, quoteTokenProgram: new PublicKey(TOKEN_PROGRAM) };
  const coinHop = { venue: onCurve ? "curve" : "pool", baseMint: market.mint, quoteMint: quote.mint, baseTokenProgram: market.tokenProgram, quoteTokenProgram: quote.program };
  return side === "buy" ? [quoteHop, coinHop] : [coinHop, quoteHop];
}

/** pump-amm's multi_hop_swap: spends exactly `lamports`; the tokens out come from a simulation and the minimum is that less the slippage. */
async function multiHopBuy({ conn, owner, market, lamports, reference, slippagePercent }) {
  const { pump } = pumpSdks();
  const hops = multiHopHops(market, "buy");
  const instructionsFor = (minAmountOut) => pump.PUMP_SDK.multiHopSwapInstructions({ user: owner, hops, side: "buy", amountIn: bn(lamports), minAmountOut });
  const outAta = ataOf(owner, market.mint, market.tokenProgram);
  const [probe, before] = await Promise.all([instructionsFor(new BN(1)), conn.getAccountInfo(outAta, "processed")]);
  const sim = await simulateUnsigned(conn, owner, probe, [outAta]);
  if (sim.value.err || !sim.value.accounts?.[0]) throw new Error(`the simulation was refused: ${JSON.stringify(sim.value.err)} ${(sim.value.logs || []).slice(-3).join(" | ")}`);
  const out = tokenAmountAt64(Buffer.from(sim.value.accounts[0].data[0], "base64")) - tokenAmountAt64(before?.data);
  if (out <= 0n) throw new Error("the simulation delivered no tokens");
  const shortfall = Number(reference.expectedTokenRaw - out) / Number(reference.expectedTokenRaw);
  if (shortfall * 100 > SOL_ROUTES.MULTI_HOP_MAX_SHORTFALL_PERCENT) {
    throw new Error(`it would deliver ${(shortfall * 100).toFixed(1)}% fewer tokens than the quote token's market price buys (limit ${SOL_ROUTES.MULTI_HOP_MAX_SHORTFALL_PERCENT}%) - the pool is probably thin or mispriced`);
  }
  if (sim.value.unitsConsumed && sim.value.unitsConsumed * 1.15 > SOL_ROUTES.COMPUTE_UNITS) throw new Error(`it needs ${sim.value.unitsConsumed} compute units, more than the ${SOL_ROUTES.COMPUTE_UNITS} allowed`);
  const minOut = (out * BigInt(Math.round((100 - slippagePercent) * 100))) / 10000n;
  return {
    venue: market.venue,
    instructions: await instructionsFor(bn(minOut)),
    expectedTokenRaw: out,
    minTokenRaw: minOut,
    createsAta: !before,
    ata: outAta,
    maxSpendLamports: lamports,
    lookupTables: [],
    note: `${Math.abs(shortfall * 100).toFixed(1)}% ${shortfall < 0 ? "more" : "fewer"} tokens than the quote token's market price buys`,
  };
}

/** An exact-out buy of the quote token on its SOL pool, to sit right before the token's own buy. */
async function poolBuyOfQuote({ conn, owner, quote, route, shortfallRaw, solUsd, quoteUsd }) {
  const { amm } = pumpSdks();
  const state = await new amm.OnlinePumpAmmSdk(conn).swapSolanaState(route.poolKey, owner);
  if (!state.pool.baseMint.equals(quote.mint) || state.pool.quoteMint.toBase58() !== WSOL_MINT) throw new Error("the pool isn't quote token / SOL");
  const base = bn(shortfallRaw);
  if (base.gte(state.poolBaseAmount)) throw new Error("the pool holds less of the quote token than the buy needs");
  const slippage = SOL_ROUTES.SWAP_SLIPPAGE_PERCENT;
  const priced = amm.buyBaseInput({
    base,
    slippage,
    quoteTransferFee: state.quoteTransferFee,
    baseReserve: state.poolBaseAmount,
    quoteReserve: state.poolQuoteAmount,
    virtualQuoteReserves: state.pool.virtualQuoteReserves,
    baseMintAccount: state.baseMintAccount,
    baseMint: state.baseMint,
    coinCreator: state.pool.coinCreator,
    creator: state.pool.creator,
    feeConfig: state.feeConfig,
    globalConfig: state.globalConfig,
    quoteMint: state.pool.quoteMint,
    isMayhemMode: state.pool.isMayhemMode,
    creatorFeeBps: state.pool.creatorFeeBps,
  });
  const costUsd = (Number(priced.uiQuote.toString()) / LAMPORTS) * solUsd;
  const worthUsd = (Number(shortfallRaw) / 10 ** quote.decimals) * quoteUsd;
  const premium = (costUsd / worthUsd - 1) * 100;
  if (premium > SOL_ROUTES.POOL_MAX_PRICE_PREMIUM_PERCENT) throw new Error(`the pool charges ${premium.toFixed(1)}% more than the quote token's market price (limit ${SOL_ROUTES.POOL_MAX_PRICE_PREMIUM_PERCENT}%) - it is probably too thin`);
  return {
    instructions: await amm.PUMP_AMM_SDK.buyBaseInput(state, base, slippage), // wraps the SOL it needs and unwraps what is left
    lookupTables: [],
    lamports: big(priced.uiQuote),
    maxLamports: big(priced.maxQuote),
    note: `${premium.toFixed(2)}% over the quote token's market price, pool ${(Number(state.poolQuoteAmount.toString()) / LAMPORTS).toFixed(1)} SOL deep`,
  };
}

/**
 * Builds the buy of a token quoted in another token, paid for with SOL, trying the routes in order.
 * @returns {Promise<{ trade: object, route: string, skipped: string[] }>} trade: { venue, instructions, expectedTokenRaw, minTokenRaw, createsAta, ata, maxSpendLamports, lookupTables, note }
 */
export async function buildPaidBuy({ conn, owner, market, budgetLamports, solUsd, slippagePercent, routes }) {
  const { quote } = market;
  const quoteUsd = await getTokenUsd(quote.mint.toBase58());
  if (!(quoteUsd > 0)) throw new TradeError(`The quote token ${quote.mint.toBase58()} has no price, so SOL can't be converted into it safely.`, "no_price");
  const budgetQuote = budgetInQuote(budgetLamports, solUsd, quoteUsd, quote);
  const skipped = [];
  for (const route of routes) {
    try {
      if (route.kind === "multihop") {
        const reference = await buildDirectBuy(market, owner, budgetQuote, slippagePercent, { quoteOnly: true });
        return { trade: await multiHopBuy({ conn, owner, market, lamports: BigInt(budgetLamports), reference, slippagePercent }), route: route.kind, skipped };
      }
      // Always paid for with SOL, whatever quote token the wallet happens to hold: the lot's cost is then exactly the SOL that left the wallet.
      const trade = await buildDirectBuy(market, owner, budgetQuote, slippagePercent);
      const needed = (budgetQuote * 1002n) / 1000n; // 0.2% headroom: the buy's cost can land a hair above its budget
      const swap = route.kind === "pool" ? await poolBuyOfQuote({ conn, owner, quote, route, shortfallRaw: needed, solUsd, quoteUsd }) : await jupiterSwapToQuote(conn, owner, quote, needed, solUsd, quoteUsd);
      return {
        trade: {
          venue: trade.venue,
          instructions: [...swap.instructions, ...trade.instructions],
          expectedTokenRaw: trade.expectedTokenRaw,
          minTokenRaw: null,
          createsAta: trade.createsAta,
          ata: trade.ata,
          maxSpendLamports: swap.maxLamports ?? swap.lamports,
          lookupTables: swap.lookupTables,
          note: swap.note ?? swap.route,
        },
        route: route.kind,
        skipped,
      };
    } catch (err) {
      skipped.push(`${ROUTE_NAMES[route.kind]}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new TradeError(`No way to pay for this token with SOL worked. ${skipped.join(" | ")}`, "no_route");
}

// ------------------------------------------------------------------ selling

/** pump-amm's multi_hop_swap the other way: the token -> quote token -> SOL in one instruction. */
async function multiHopSell({ conn, owner, market, tokenRaw, reference, slippagePercent }) {
  const { pump } = pumpSdks();
  const hops = multiHopHops(market, "sell");
  const instructionsFor = (minAmountOut) => pump.PUMP_SDK.multiHopSwapInstructions({ user: owner, hops, side: "sell", amountIn: bn(tokenRaw), minAmountOut });
  const out = big(await new pump.OnlinePumpSdk(conn).simulateMultiHopSwap({ user: owner, hops, side: "sell", amountIn: bn(tokenRaw) }));
  if (out <= 0n) throw new Error("the simulation paid no SOL");
  const shortfall = Number(reference.expectedLamports - out) / Number(reference.expectedLamports);
  if (shortfall * 100 > SOL_ROUTES.SELL_MAX_SHORTFALL_PERCENT) throw new Error(`it would pay ${(shortfall * 100).toFixed(1)}% less than the market price (limit ${SOL_ROUTES.SELL_MAX_SHORTFALL_PERCENT}%)`);
  const minOut = (out * BigInt(Math.round((100 - slippagePercent) * 100))) / 10000n;
  return { instructions: await instructionsFor(bn(minOut)), expectedLamports: out, minLamports: minOut, lookupTables: [], note: `${Math.abs(shortfall * 100).toFixed(1)}% ${shortfall < 0 ? "more" : "less"} than the market price` };
}

/** The token's own sale for the quote token, then the quote token sold for SOL on its pool - both in one transaction. */
async function poolSell({ conn, owner, market, route, tokenRaw, slippagePercent, solUsd, quoteUsd }) {
  const { amm } = pumpSdks();
  const { quote } = market;
  const quoteAta = ataOf(owner, quote.mint, quote.program);
  const first = await buildDirectSell(market, owner, tokenRaw, slippagePercent);
  const [sim, held] = await Promise.all([
    simulateUnsigned(conn, owner, first.instructions, [quoteAta]),
    conn.getTokenAccountBalance(quoteAta, "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n),
  ]);
  if (sim.value.err || !sim.value.accounts?.[0]) throw new Error(`the simulation was refused: ${JSON.stringify(sim.value.err)} ${(sim.value.logs || []).slice(-3).join(" | ")}`);
  const delta = tokenAmountAt64(Buffer.from(sim.value.accounts[0].data[0], "base64")) - held;
  if (delta <= 0n) throw new Error("the simulation delivered no quote tokens");
  // Sell a little less than the simulation shows (the real price can differ a hair), plus whatever an earlier sale left behind.
  const amountIn = (delta * BigInt(Math.round((100 - SOL_ROUTES.SELL_SWAP_MARGIN_PERCENT) * 100))) / 10000n + held;

  const state = await new amm.OnlinePumpAmmSdk(conn).swapSolanaState(route.poolKey, owner);
  if (!state.pool.baseMint.equals(quote.mint) || state.pool.quoteMint.toBase58() !== WSOL_MINT) throw new Error("the pool isn't quote token / SOL");
  const priced = amm.sellBaseInput({
    base: bn(amountIn),
    slippage: SOL_ROUTES.SWAP_SLIPPAGE_PERCENT,
    quoteTransferFee: state.quoteTransferFee,
    baseReserve: state.poolBaseAmount,
    quoteReserve: state.poolQuoteAmount,
    virtualQuoteReserves: state.pool.virtualQuoteReserves,
    feeBucketsTotal: state.pool.protocolFees.add(state.pool.creatorFees),
    baseMintAccount: state.baseMintAccount,
    baseMint: state.baseMint,
    coinCreator: state.pool.coinCreator,
    creator: state.pool.creator,
    feeConfig: state.feeConfig,
    globalConfig: state.globalConfig,
    quoteMint: state.pool.quoteMint,
    isMayhemMode: state.pool.isMayhemMode,
    creatorFeeBps: state.pool.creatorFeeBps,
  });
  const worthUsd = (Number(amountIn) / 10 ** quote.decimals) * quoteUsd;
  const paidUsd = (Number(priced.uiQuote.toString()) / LAMPORTS) * solUsd;
  const shortfall = 1 - paidUsd / worthUsd;
  if (shortfall * 100 > SOL_ROUTES.SELL_MAX_SHORTFALL_PERCENT) throw new Error(`the pool pays ${(shortfall * 100).toFixed(1)}% less than the quote token's market price (limit ${SOL_ROUTES.SELL_MAX_SHORTFALL_PERCENT}%)`);
  const second = await amm.PUMP_AMM_SDK.sellBaseInput(state, bn(amountIn), SOL_ROUTES.SWAP_SLIPPAGE_PERCENT);
  return {
    instructions: [...first.instructions, ...second],
    expectedLamports: big(priced.uiQuote),
    minLamports: big(priced.minQuote),
    lookupTables: [],
    note: `${Math.abs(shortfall * 100).toFixed(2)}% ${shortfall < 0 ? "over" : "under"} the quote token's market price`,
  };
}

/**
 * Builds the sale of a token quoted in another token so that it pays out SOL, trying the routes in order.
 * @returns {Promise<{ sale: { venue, instructions, expectedLamports, minLamports, lookupTables, note }, route: string, skipped: string[] }>}
 */
export async function buildPaidSell({ conn, owner, market, tokenRaw, solUsd, slippagePercent, routes }) {
  const { quote } = market;
  const quoteUsd = await getTokenUsd(quote.mint.toBase58());
  if (!(quoteUsd > 0)) throw new TradeError(`The quote token ${quote.mint.toBase58()} has no price, so the sale can't be checked against the market.`, "no_price");
  const direct = await buildDirectSell(market, owner, tokenRaw, slippagePercent, { quoteOnly: true });
  const reference = { expectedLamports: BigInt(Math.floor((Number(direct.expectedQuoteRaw) / 10 ** quote.decimals) * (quoteUsd / solUsd) * LAMPORTS)) };
  const skipped = [];
  for (const route of routes.filter((r) => r.kind !== "jupiter")) {
    try {
      const sale = route.kind === "multihop" ? await multiHopSell({ conn, owner, market, tokenRaw, reference, slippagePercent }) : await poolSell({ conn, owner, market, route, tokenRaw, slippagePercent, solUsd, quoteUsd });
      return { sale: { venue: market.venue, ...sale }, route: route.kind, skipped };
    } catch (err) {
      skipped.push(`${ROUTE_NAMES[route.kind]}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new TradeError(`No way to turn this token's quote token back into SOL worked. ${skipped.join(" | ") || "No route exists."}`, "no_route");
}

/** The estimate used when only a price is wanted: what the sale would pay in SOL at the quote token's market price. */
export async function estimateSellLamports(expectedQuoteRaw, quote, solUsd) {
  const quoteUsd = await getTokenUsd(quote.mint.toBase58());
  if (!(quoteUsd > 0)) throw new TradeError(`The quote token ${quote.mint.toBase58()} has no price.`, "no_price");
  return BigInt(Math.floor((Number(expectedQuoteRaw) / 10 ** quote.decimals) * (quoteUsd / solUsd) * LAMPORTS));
}

export { budgetInQuote, sleepRoute };
