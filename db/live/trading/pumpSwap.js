import { Connection } from "@solana/web3.js";
import { getTokenUsd, pickRpcUrl } from "../../onchainPrice.js";
import { resolveMarket, TradeError } from "./market.js";
import { buildDirectBuy, buildDirectSell } from "./directSwap.js";
import { budgetInQuote, buildPaidBuy, findSolRoutes, SOL_ROUTES } from "./solRoutes.js";
import { buildSellStage, describePlan, quoteSellPlan, resolveSellPlan } from "./sellChain.js";
import { DEFAULT_COMPUTE_UNITS } from "./liveTx.js";

/**
 * Builds the swap instructions for buying and selling a pump.fun token with SOL - on the bonding curve while the token is still on
 * it, and in its PumpSwap pool once it has graduated - using pump.fun's own SDKs, so the account lists follow the programs.
 * Nothing here sends anything: every function returns instructions plus what the trade is expected to give, and the caller
 * decides whether to sign and send them (live) or only record the expectation (dry run).
 *
 * A token is not always quoted in SOL (USDC, PUMP, ... are quote tokens too). With `payWithSol` such a token is still traded with SOL alone:
 * the SOL is turned into the quote token inside the same transaction and back again on a sale (db/live/trading/solRoutes.js). Without it a
 * token-quoted market is refused with code "unsupported_quote" - which is what the simulation's price quotes rely on.
 *
 * Amounts are in raw units (lamports for SOL, the token's smallest unit for tokens) and travel as BigInt.
 * `slippagePercent` is the price move the trade tolerates before the program refuses it (1 = 1%): a buy may cost up to that
 * much more than quoted, a sell may pay up to that much less. A refused trade costs nothing but the network fee.
 */

export { TradeError };

async function connection() {
  return new Connection(await pickRpcUrl(), "confirmed");
}

/**
 * Where a token trades right now: "curve" or "amm", with its token program, decimals and the token it is quoted in.
 * @deprecated kept for callers outside this folder; use resolveMarket for new code.
 */
export async function getMarket(mint, conn) {
  const market = await resolveMarket(conn ?? (await connection()), mint);
  return { mint, tokenProgram: market.tokenProgram, decimals: market.decimals, conn: market.conn, venue: market.venue };
}

/**
 * @param {{ owner: PublicKey, mint: string, budgetLamports: bigint | number, slippagePercent: number, solUsd?: number, payWithSol?: boolean, quoteOnly?: boolean, conn?: Connection }} options
 *   budgetLamports is what the swap may spend INCLUDING pump.fun's own fee.
 *   quoteOnly: only price the purchase; no instructions are built, so `owner` can be any address.
 * @returns {Promise<{ venue: "curve"|"amm", route: "direct"|"multihop"|"pool"|"jupiter"|"estimate", instructions: TransactionInstruction[], expectedTokenRaw: bigint,
 *   maxCostLamports: bigint, tokenProgram: PublicKey, decimals: number, ata: PublicKey, createsAta: boolean, computeUnits: number,
 *   lookupTables: AddressLookupTableAccount[], quoteMint: string | null, note: string | null, skipped: string[] }>}
 */
export async function prepareBuy({ owner, mint, budgetLamports, slippagePercent, solUsd, payWithSol = false, quoteOnly = false, conn: given }) {
  const conn = given ?? (await connection());
  const market = await resolveMarket(conn, mint);
  const base = { tokenProgram: market.tokenProgram, decimals: market.decimals, quoteMint: market.quote?.mint.toBase58() ?? null, lookupTables: [], skipped: [], note: null };

  if (!market.quote) {
    const trade = await buildDirectBuy(market, owner, budgetLamports, slippagePercent, { quoteOnly });
    return { ...base, venue: trade.venue, route: "direct", instructions: trade.instructions, expectedTokenRaw: trade.expectedTokenRaw, maxCostLamports: trade.maxCostRaw, ata: trade.ata, createsAta: trade.createsAta, computeUnits: DEFAULT_COMPUTE_UNITS };
  }

  if (!payWithSol) throw new TradeError("This token is quoted in something other than SOL.", "unsupported_quote");
  if (!(solUsd > 0)) throw new TradeError("The SOL price isn't available.", "no_price");
  const routes = await findSolRoutes(conn, market.quote);
  if (!routes.length) throw new TradeError(`This token is quoted in ${market.quote.mint.toBase58()} and there is no way to pay for that with SOL.`, "no_route");

  if (quoteOnly) {
    // Priced at the quote token's market price: the same dollars buy the same tokens, less the cost of turning SOL into the quote token (not modelled here).
    const quoteUsd = await getTokenUsd(market.quote.mint.toBase58());
    if (!(quoteUsd > 0)) throw new TradeError(`The quote token ${market.quote.mint.toBase58()} has no price.`, "no_price");
    const trade = await buildDirectBuy(market, owner, budgetInQuote(budgetLamports, solUsd, quoteUsd, market.quote), slippagePercent, { quoteOnly: true });
    return { ...base, venue: trade.venue, route: "estimate", instructions: [], expectedTokenRaw: trade.expectedTokenRaw, maxCostLamports: BigInt(budgetLamports), ata: trade.ata, createsAta: trade.createsAta, computeUnits: SOL_ROUTES.COMPUTE_UNITS, note: `would be paid via ${routes[0].kind}` };
  }

  const { trade, route, skipped } = await buildPaidBuy({ conn, owner, market, budgetLamports, solUsd, slippagePercent, routes });
  return {
    ...base,
    venue: trade.venue,
    route,
    instructions: trade.instructions,
    expectedTokenRaw: trade.expectedTokenRaw,
    maxCostLamports: trade.maxSpendLamports > 0n ? trade.maxSpendLamports : BigInt(budgetLamports),
    ata: trade.ata,
    createsAta: trade.createsAta,
    computeUnits: SOL_ROUTES.COMPUTE_UNITS,
    lookupTables: trade.lookupTables,
    note: trade.note,
    skipped,
  };
}

/**
 * @param {{ owner: PublicKey, mint: string, from?: string, tokenRaw: bigint | number, slippagePercent: number, solUsd?: number, payWithSol?: boolean, quoteOnly?: boolean,
 *   fitTables?: Function, conn?: Connection }} options
 *   quoteOnly: only price the sale (a dry run holds no tokens and has no token account, so there is nothing to build instructions for).
 *   from: for a token quoted in other tokens, the token this transaction starts from (default: `mint`). A sale is a chain of swaps down to SOL that can take
 *   several transactions: the first sells `mint`, each next one sells what the one before paid out (a quote token) - see db/live/trading/sellChain.js.
 *   fitTables: see buildSellStage (live sales of quoted tokens only).
 * @returns {Promise<{ venue: "curve"|"amm", route: string, instructions: TransactionInstruction[], expectedLamports: bigint | null, minLamports: bigint | null,
 *   tokenProgram: PublicKey, decimals: number, ata: PublicKey | null, computeUnits: number, lookupTables: AddressLookupTableAccount[], quoteMint: string | null, note: string | null,
 *   skipped: string[], stage: { fromMint: string, toMint: string, final: boolean, nextIndex: number, expectedOutRaw: bigint, minOutRaw: bigint } | null }>}
 *   expectedLamports is what the sale should pay out after pump.fun's fees; minLamports is the least the program will accept. A stage that does not end in SOL has neither:
 *   its `stage` says what token it ends in and how much of it is expected.
 */
export async function prepareSell({ owner, mint, from, tokenRaw, slippagePercent, solUsd, payWithSol = false, quoteOnly = false, fitTables, conn: given }) {
  const conn = given ?? (await connection());
  const market = await resolveMarket(conn, mint);
  const base = { tokenProgram: market.tokenProgram, decimals: market.decimals, quoteMint: market.quote?.mint.toBase58() ?? null, lookupTables: [], skipped: [], note: null, stage: null };

  if (!market.quote) {
    const sale = await buildDirectSell(market, owner, tokenRaw, slippagePercent, { quoteOnly });
    return { ...base, venue: sale.venue, route: "direct", instructions: sale.instructions, expectedLamports: sale.expectedQuoteRaw, minLamports: sale.minQuoteRaw, ata: sale.ata, computeUnits: DEFAULT_COMPUTE_UNITS };
  }

  if (!payWithSol) throw new TradeError("This token is quoted in something other than SOL.", "unsupported_quote");
  if (!(solUsd > 0)) throw new TradeError("The SOL price isn't available.", "no_price");
  const steps = await resolveSellPlan(conn, market);

  if (quoteOnly) {
    const expectedLamports = await quoteSellPlan({ conn, owner, steps, tokenRaw, slippagePercent });
    return { ...base, venue: market.venue, route: "estimate", instructions: [], expectedLamports, minLamports: expectedLamports, ata: null, computeUnits: 150_000 + 220_000 * steps.length, note: `would be sold ${describePlan(steps)}` };
  }

  const fromIndex = steps.findIndex((s) => s.mint.toBase58() === (from ?? mint));
  if (fromIndex < 0) throw new TradeError(`${from} isn't on the way from ${mint} down to SOL (${describePlan(steps)}).`, "no_route");
  const stage = await buildSellStage({ conn, owner, steps, from: fromIndex, amountRaw: tokenRaw, slippagePercent, solUsd, fitTables });
  return {
    ...base,
    venue: stage.venue,
    route: stage.route,
    instructions: stage.instructions,
    expectedLamports: stage.final ? stage.expectedOutRaw : null,
    minLamports: stage.final ? stage.minOutRaw : null,
    ata: null,
    computeUnits: stage.computeUnits,
    lookupTables: stage.lookupTables,
    note: stage.note,
    skipped: stage.skipped,
    stage: { fromMint: stage.fromMint.toBase58(), toMint: stage.toMint.toBase58(), final: stage.final, nextIndex: stage.nextIndex, expectedOutRaw: stage.expectedOutRaw, minOutRaw: stage.minOutRaw },
  };
}
