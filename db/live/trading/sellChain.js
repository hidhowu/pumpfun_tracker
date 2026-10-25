import { PublicKey } from "@solana/web3.js";
import { getTokenUsd } from "../../onchainPrice.js";
import { pumpSdks } from "./sdk.js";
import { ataOf, resolveMarket, TOKEN_PROGRAM, TradeError, WSOL, WSOL_MINT } from "./market.js";
import { big, bn, buildDirectSell } from "./directSwap.js";
import { deepestSolPool, jupiter, jupiterRouteLabel, jupiterSwapPlan, simulateUnsigned, SOL_ROUTES } from "./solRoutes.js";

/**
 * Selling a token that is not quoted in SOL: follow the quote tokens down until SOL is reached.
 *
 * A token can be quoted in another token, which is quoted in another, and so on (token -> PMD -> PUMP -> SOL). The sale is the same chain walked
 * downwards, one swap per link, and the money that comes out of it is always SOL. resolveSellPlan finds the links; each link ("step") is one of
 *
 *   canon    the token's own market: its bonding curve or its canonical PumpSwap pool. These can be chained inside ONE instruction
 *            (pump-amm's multi_hop_swap), however many there are.
 *   pool     a PumpSwap pool of a token that is not a pump.fun coin (USDC, PUMP, ...) against SOL.
 *   jupiter  anything else: Jupiter finds the way from this token to SOL. It goes in a transaction of its own.
 *
 * buildSellStage then packs as many consecutive steps as fit ONE transaction (the lookup table of the wallet shrinks the long ones). What does not
 * fit is left for a following transaction, which starts from what the previous one paid out (a token), and so on until a stage ends in SOL.
 * Only the first stage sells the token the wallet actually holds; db/live/trading/executor.js sends it the way the wallet is set to (Jito or raw)
 * and every later stage raw.
 */

const MAX_STEPS = 8;
const SOL = { mint: WSOL, program: new PublicKey(TOKEN_PROGRAM), decimals: 9 };
const tokenAmountAt64 = (data) => (data ? data.readBigUInt64LE(64) : 0n);
const short = (mint) => `${mint.toBase58().slice(0, 6)}…`;

// ------------------------------------------------------------------ finding the chain

/** Made on pump.fun and trading where the pump programs say it does: the only markets multi_hop_swap can use. */
async function isCanonical(conn, market) {
  if (!market.curve) return false; // not a pump.fun coin: it has no canonical pool
  if (market.venue === "curve") return true;
  return !!(await conn.getAccountInfo(market.poolKey, "confirmed"));
}

/**
 * @param {import("@solana/web3.js").Connection} conn
 * @param {Awaited<ReturnType<import("./market.js").resolveMarket>>} market the token being sold
 * @returns {Promise<{ kind: "canon" | "pool" | "jupiter", market: object, mint: PublicKey, program: PublicKey, decimals: number,
 *   toMint: PublicKey, toProgram: PublicKey, toDecimals: number, poolKey?: PublicKey }[]>} the swaps in selling order; the last one ends in SOL
 */
export async function resolveSellPlan(conn, market) {
  const steps = [];
  const seen = new Set();
  let current = market;
  while (true) {
    const key = current.mint.toBase58();
    if (seen.has(key) || steps.length >= MAX_STEPS) throw new TradeError(`The quote tokens of ${market.mint.toBase58()} loop or go more than ${MAX_STEPS} deep, so there is no way down to SOL.`, "no_route");
    seen.add(key);
    const to = current.quote ?? SOL;
    const link = { market: current, mint: current.mint, program: current.tokenProgram, decimals: current.decimals, toMint: to.mint, toProgram: to.program, toDecimals: to.decimals };
    if (await isCanonical(conn, current)) {
      steps.push({ kind: "canon", ...link });
      if (!current.quote) return steps;
      current = await resolveMarket(conn, current.quote.mint.toBase58());
      continue;
    }
    // Not a canonical pump market: a PumpSwap pool against SOL when there is one, otherwise Jupiter finds the rest of the way.
    const poolKey = !current.quote ? await deepestSolPool(current.mint).catch(() => null) : null;
    steps.push(poolKey ? { kind: "pool", ...link, poolKey } : { kind: "jupiter", ...link, toMint: SOL.mint, toProgram: SOL.program, toDecimals: SOL.decimals });
    return steps;
  }
}

/** "A… > B… > SOL": the tokens a run of steps goes through, ending in where the last one pays out. */
export function describePlan(steps) {
  const end = steps[steps.length - 1].toMint;
  return [...steps.map((s) => short(s.mint)), end.equals(WSOL) ? "SOL" : short(end)].join(" > ");
}

// ------------------------------------------------------------------ pools and Jupiter

async function poolState(conn, owner, step) {
  const { amm } = pumpSdks();
  const state = await new amm.OnlinePumpAmmSdk(conn).swapSolanaState(step.poolKey, owner);
  if (!state.pool.baseMint.equals(step.mint) || !state.pool.quoteMint.equals(step.toMint)) throw new Error(`the pool isn't ${short(step.mint)} / ${short(step.toMint)}`);
  return state;
}

function priceOnPool(state, amount, slippagePercent) {
  const { amm } = pumpSdks();
  return amm.sellBaseInput({
    base: bn(amount),
    slippage: slippagePercent,
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
}

async function jupiterSellQuote(step, amount, slippagePercent) {
  const slippageBps = Math.min(5000, Math.round(slippagePercent * 100));
  const exclude = SOL_ROUTES.JUPITER_EXCLUDE_DEXES ? `&excludeDexes=${encodeURIComponent(SOL_ROUTES.JUPITER_EXCLUDE_DEXES)}` : "";
  return jupiter(`/quote?inputMint=${step.mint.toBase58()}&outputMint=${WSOL_MINT}&amount=${amount}&slippageBps=${slippageBps}&maxAccounts=${SOL_ROUTES.JUPITER_SELL_MAX_ACCOUNTS}${exclude}`);
}

// ------------------------------------------------------------------ the dry run: what the whole chain would pay

/**
 * What selling `tokenRaw` all the way down to SOL would pay (lamports), swap by swap with each pool's or curve's own numbers. Nothing is built or
 * sent, so `owner` can be any address. (Inside a multi-hop instruction the middle swaps charge no fee, so this is a little on the low side.)
 */
export async function quoteSellPlan({ conn, owner, steps, tokenRaw, slippagePercent }) {
  let amount = BigInt(tokenRaw);
  for (const step of steps) {
    if (step.kind === "canon") amount = (await buildDirectSell(step.market, owner, amount, slippagePercent, { quoteOnly: true })).expectedQuoteRaw;
    else if (step.kind === "pool") amount = big(priceOnPool(await poolState(conn, owner, step), amount, SOL_ROUTES.SWAP_SLIPPAGE_PERCENT).uiQuote);
    else amount = BigInt((await jupiterSellQuote(step, amount, slippagePercent)).outAmount);
    if (amount <= 0n) throw new TradeError(`Selling ${short(step.mint)} would pay nothing.`, "no_route");
  }
  return amount;
}

// ------------------------------------------------------------------ live: one transaction of the chain

async function usdOf(mint, solUsd) {
  if (mint.equals(WSOL)) return solUsd;
  const usd = await getTokenUsd(mint.toBase58());
  if (!(usd > 0)) throw new TradeError(`The token ${mint.toBase58()} has no price, so the sale can't be checked against the market.`, "no_price");
  return usd;
}

/** Refuses a stage that pays clearly less than the first swap's proceeds are worth at the market price: a thin or mispriced pool on the way. */
async function checkAgainstMarket({ run, firstOutRaw, outRaw, solUsd }) {
  const first = run[0];
  const worth = (Number(firstOutRaw) / 10 ** first.toDecimals) * (await usdOf(first.toMint, solUsd));
  const last = run[run.length - 1];
  const paid = (Number(outRaw) / 10 ** last.toDecimals) * (await usdOf(last.toMint, solUsd));
  const shortfall = (1 - paid / worth) * 100;
  if (shortfall > SOL_ROUTES.SELL_MAX_SHORTFALL_PERCENT) {
    throw new Error(`it would pay ${shortfall.toFixed(1)}% less than the market price (limit ${SOL_ROUTES.SELL_MAX_SHORTFALL_PERCENT}%) - a pool on the way is probably thin or mispriced`);
  }
}

const computeUnitsFor = (unitsConsumed, swaps) => Math.min(1_400_000, unitsConsumed ? Math.ceil(unitsConsumed * 1.3) + 30_000 : 150_000 + 220_000 * swaps);

/**
 * Builds ONE transaction of the sale, from step `from`, selling `amountRaw` of that step's token: as many consecutive steps as fit, the whole rest of
 * the chain if it can be done in one transaction. A run that can't be built (too big even with the lookup table, refused by the simulation, a pool too
 * far from the market price, ...) is given up for the next shorter one, down to a single swap.
 *
 * `fitTables(instructions, rebuild, extraTables, { mayGrow })` makes sure the instructions fit one transaction and returns the tables to simulate with;
 * it throws when they don't. Only a single swap may grow the wallet's lookup table (slow, and costs rent): a longer run that doesn't fit is split instead.
 *
 * @returns {Promise<{ instructions: object[], lookupTables: object[], computeUnits: number, venue: string, route: string, fromMint: PublicKey, toMint: PublicKey,
 *   nextIndex: number, final: boolean, expectedOutRaw: bigint, minOutRaw: bigint, note: string | null, skipped: string[] }>}
 *   the amounts are in the token the stage ends in (lamports when it is the final stage)
 */
export async function buildSellStage({ conn, owner, steps, from, amountRaw, slippagePercent, solUsd, fitTables }) {
  const skipped = [];
  for (let end = steps.length; end > from; end--) {
    const run = steps.slice(from, end);
    try {
      const stage = await buildRun({ conn, owner, steps, run, end, amountRaw: BigInt(amountRaw), slippagePercent, solUsd, fitTables });
      return { ...stage, skipped };
    } catch (err) {
      skipped.push(`${describePlan(run)}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new TradeError(`No way to sell this token down to SOL worked. ${skipped.join(" | ")}`, "no_route");
}

async function buildRun({ conn, owner, steps, run, end, amountRaw, slippagePercent, solUsd, fitTables }) {
  const { pump, amm } = pumpSdks();
  const last = run[run.length - 1];
  const tail = last.kind === "canon" ? null : last;
  const canon = tail ? run.slice(0, -1) : run;
  const final = end === steps.length;
  const base = { fromMint: run[0].mint, toMint: last.toMint, nextIndex: end, final, skipped: [] };
  const swaps = run.length;

  // ---- a Jupiter swap, alone
  if (tail?.kind === "jupiter") {
    if (canon.length) throw new Error("a Jupiter swap goes in a transaction of its own");
    const quote = await jupiterSellQuote(tail, amountRaw, slippagePercent);
    const plan = await jupiterSwapPlan(conn, owner, quote);
    await fitTables(plan.instructions, async () => plan.instructions, plan.lookupTables, { mayGrow: true });
    return { ...base, instructions: plan.instructions, lookupTables: plan.lookupTables, computeUnits: computeUnitsFor(0, 2), venue: "amm", route: "jupiter", expectedOutRaw: BigInt(quote.outAmount), minOutRaw: BigInt(quote.otherAmountThreshold), note: jupiterRouteLabel(quote) };
  }

  // ---- the canonical part: one swap on its own market, or several chained in one multi_hop_swap instruction
  let canonInstructions;
  let multiHop = null;
  let directMin = null;
  let directOut = null;
  if (canon.length === 1) {
    const sale = await buildDirectSell(canon[0].market, owner, amountRaw, slippagePercent);
    canonInstructions = async () => sale.instructions;
    directOut = sale.expectedQuoteRaw;
    directMin = sale.minQuoteRaw;
  } else {
    const path = [canon[0].mint, ...canon.map((s) => s.toMint)];
    const hops = await new pump.OnlinePumpSdk(conn).resolveMultiHopRoute(path, "sell");
    multiHop = { hops };
    canonInstructions = (minOut) => pump.PUMP_SDK.multiHopSwapInstructions({ user: owner, hops, side: "sell", amountIn: bn(amountRaw), minAmountOut: bn(minOut) });
  }
  const venue = canon[0].market.venue;
  const canonLast = canon[canon.length - 1];
  const probeCanon = () => canonInstructions(1n); // the accounts it uses are the same whatever the minimum

  // ---- the pool tail (a pool of a non-pump token against SOL), in the same transaction
  let state = null;
  let tailInstructions = async () => [];
  if (tail) {
    state = await poolState(conn, owner, tail);
    tailInstructions = (amount) => amm.PUMP_AMM_SDK.sellBaseInput(state, bn(amount), SOL_ROUTES.SWAP_SLIPPAGE_PERCENT);
  }
  const one = 10n ** BigInt(tail?.decimals ?? 6);
  const rebuild = async () => [...(await probeCanon()), ...(tail ? await tailInstructions(one) : [])];
  const tables = await fitTables(await rebuild(), rebuild, [], { mayGrow: swaps === 1 });

  // ---- how much the canonical part pays: the chain's own numbers when it is a single swap alone, otherwise a simulation (the wallet holds the tokens)
  let canonOut = directOut;
  let unitsConsumed = 0;
  if (multiHop || tail) {
    if (multiHop && !tail && canonLast.toMint.equals(WSOL)) {
      canonOut = big(await new pump.OnlinePumpSdk(conn).simulateMultiHopSwap({ user: owner, hops: multiHop.hops, side: "sell", amountIn: bn(amountRaw), addressLookupTables: tables }));
    } else {
      const outAta = ataOf(owner, canonLast.toMint, canonLast.toProgram);
      const [sim, held] = await Promise.all([
        simulateUnsigned(conn, owner, await probeCanon(), [outAta], tables),
        conn.getTokenAccountBalance(outAta, "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n),
      ]);
      if (sim.value.err || !sim.value.accounts?.[0]) throw new Error(`the simulation was refused: ${JSON.stringify(sim.value.err)} ${(sim.value.logs || []).slice(-3).join(" | ")}`);
      canonOut = tokenAmountAt64(Buffer.from(sim.value.accounts[0].data[0], "base64")) - held;
      unitsConsumed = sim.value.unitsConsumed ?? 0;
    }
    if (canonOut <= 0n) throw new Error("the simulation paid nothing");
  }

  // ---- the final numbers and instructions
  let instructions;
  let expectedOutRaw;
  let minOutRaw;
  let route = "direct";
  if (tail) {
    // Sell a little less than the simulation shows, and have the first part refuse to pay less than that, so the tail never asks for tokens that aren't there.
    const tailAmount = (canonOut * BigInt(Math.round((100 - SOL_ROUTES.SELL_SWAP_MARGIN_PERCENT) * 100))) / 10000n;
    const priced = priceOnPool(state, tailAmount, SOL_ROUTES.SWAP_SLIPPAGE_PERCENT);
    expectedOutRaw = big(priced.uiQuote);
    minOutRaw = big(priced.minQuote);
    instructions = [...(await canonInstructions(tailAmount)), ...(await tailInstructions(tailAmount))];
    route = "pool";
  } else if (multiHop) {
    expectedOutRaw = canonOut;
    minOutRaw = (canonOut * BigInt(Math.round((100 - slippagePercent) * 100))) / 10000n;
    instructions = await canonInstructions(minOutRaw);
    route = "multihop";
  } else {
    expectedOutRaw = directOut;
    minOutRaw = directMin;
    instructions = await canonInstructions();
  }
  if (swaps >= 2) {
    const firstOutRaw = (await buildDirectSell(canon[0].market, owner, amountRaw, slippagePercent, { quoteOnly: true })).expectedQuoteRaw;
    await checkAgainstMarket({ run, firstOutRaw, outRaw: expectedOutRaw, solUsd });
  }
  const note = swaps >= 2 ? `${describePlan(run)}${final ? "" : " (the rest follows in the next transaction)"}` : null;
  return { ...base, instructions, lookupTables: [], computeUnits: computeUnitsFor(unitsConsumed, swaps), venue, route, expectedOutRaw, minOutRaw, note };
}

