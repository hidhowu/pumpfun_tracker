import BN from "bn.js";
import { pumpSdks } from "./sdk.js";
import { ataOf, TradeError } from "./market.js";

/**
 * One buy or sell of a token on its own market, in the market's own quote: on its bonding curve, or in its PumpSwap pool once graduated,
 * for SOL when the market is SOL-quoted or for the quote token (USDC, PUMP, ...) when it is not. Nothing is sent; every function returns the
 * instructions and what the trade is expected to give. Amounts are raw units (BN or BigInt in, BigInt out).
 *
 * `slippagePercent` is the price move tolerated before the program refuses the trade (1 = 1%): a buy may cost up to that much more than quoted,
 * a sell may pay up to that much less. `quoteOnly` prices the trade without building instructions (so `owner` can be any address).
 */

export const bn = (value) => new BN(value.toString());
export const big = (value) => BigInt(value.toString());

/** Per-mille slippage the way the SDK reads it (so 12.5% = 125). */
const permille = (slippagePercent) => new BN(Math.floor(slippagePercent * 10));

/**
 * @param {Awaited<ReturnType<import("./market.js").resolveMarket>>} market
 * @param {import("@solana/web3.js").PublicKey} owner
 * @param {bigint | number} budgetRaw what the swap may spend IN THE MARKET'S QUOTE (lamports for SOL), pump.fun's fee included
 * @returns {Promise<{ venue: "curve" | "amm", instructions: import("@solana/web3.js").TransactionInstruction[], expectedTokenRaw: bigint, maxCostRaw: bigint, createsAta: boolean, ata: import("@solana/web3.js").PublicKey }>}
 */
export async function buildDirectBuy(market, owner, budgetRaw, slippagePercent, { quoteOnly = false } = {}) {
  const { pump, amm } = pumpSdks();
  const { conn, mint, tokenProgram } = market;
  const budget = bn(budgetRaw);
  if (budget.lten(0)) throw new TradeError("Nothing to spend.", "bad_amount");

  if (market.venue === "curve") {
    const online = new pump.OnlinePumpSdk(conn);
    const [global, feeConfig, state] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchBuyState(mint, owner, tokenProgram)]);
    const solQuoted = pump.isSolLikeQuoteMint(state.quoteMint);
    if (solQuoted !== !market.quote || (!solQuoted && !state.quoteMint.equals(market.quote.mint))) throw new TradeError("The token's quote changed while the buy was being built - try again.", "quote_changed");
    const tokens = pump.getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: state.bondingCurve.tokenTotalSupply,
      bondingCurve: state.bondingCurve,
      amount: budget,
      quoteMint: state.quoteMint,
      quoteTransferFee: state.quoteTransferFee,
    });
    if (tokens.lten(0)) throw new TradeError("The amount is too small to buy any of this token.", "bad_amount");
    const common = {
      global,
      bondingCurveAccountInfo: state.bondingCurveAccountInfo,
      bondingCurve: state.bondingCurve,
      associatedUserAccountInfo: state.associatedUserAccountInfo,
      mint,
      user: owner,
      amount: tokens,
      slippage: slippagePercent,
      tokenProgram,
    };
    const instructions = quoteOnly
      ? []
      : solQuoted
        ? await pump.PUMP_SDK.buyInstructions({ ...common, solAmount: budget })
        : await pump.PUMP_SDK.buyV2Instructions({ ...common, quoteAmount: budget, quoteTokenProgram: state.quoteTokenProgram });
    return {
      venue: "curve",
      instructions,
      expectedTokenRaw: big(tokens),
      maxCostRaw: big(budget.add(budget.mul(permille(slippagePercent)).div(new BN(1000)))),
      createsAta: !state.associatedUserAccountInfo,
      ata: ataOf(owner, mint, tokenProgram),
    };
  }

  const online = new amm.OnlinePumpAmmSdk(conn);
  const state = await online.swapSolanaState(market.poolKey, owner).catch(() => null);
  if (!state) throw new TradeError("This token has no pool to trade in yet.", "no_market");
  const quote = amm.buyQuoteInput({
    quote: budget,
    slippage: slippagePercent,
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
  const instructions = quoteOnly ? [] : await amm.PUMP_AMM_SDK.buyQuoteInput(state, budget, slippagePercent);
  return { venue: "amm", instructions, expectedTokenRaw: big(quote.base), maxCostRaw: big(quote.maxQuote), createsAta: !state.userBaseAccountInfo, ata: state.userBaseTokenAccount };
}

/**
 * @returns {Promise<{ venue: "curve" | "amm", instructions: import("@solana/web3.js").TransactionInstruction[], expectedQuoteRaw: bigint, minQuoteRaw: bigint, ata: import("@solana/web3.js").PublicKey }>}
 *   expectedQuoteRaw is what the sale should pay out (in the market's quote) after pump.fun's fees; minQuoteRaw is the least the program accepts.
 */
export async function buildDirectSell(market, owner, tokenRaw, slippagePercent, { quoteOnly = false } = {}) {
  const { pump, amm } = pumpSdks();
  const { conn, mint, tokenProgram } = market;
  const amount = bn(tokenRaw);
  if (amount.lten(0)) throw new TradeError("Nothing to sell.", "bad_amount");

  if (market.venue === "curve") {
    const online = new pump.OnlinePumpSdk(conn);
    const [global, feeConfig, state] = await Promise.all([
      online.fetchGlobal(),
      online.fetchFeeConfig(),
      quoteOnly
        ? online.fetchBondingCurve(mint).then((bondingCurve) => ({ bondingCurve, quoteMint: pump.normalizeQuoteMint(bondingCurve.quoteMint), quoteTransferFee: null, bondingCurveAccountInfo: null, quoteTokenProgram: market.quote?.program }))
        : online.fetchSellState(mint, owner, tokenProgram),
    ]);
    const solQuoted = pump.isSolLikeQuoteMint(state.quoteMint);
    if (solQuoted !== !market.quote || (!solQuoted && !state.quoteMint.equals(market.quote.mint))) throw new TradeError("The token's quote changed while the sell was being built - try again.", "quote_changed");
    const quoteAmount = pump.getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: state.bondingCurve.tokenTotalSupply,
      bondingCurve: state.bondingCurve,
      amount,
      quoteTransferFee: state.quoteTransferFee,
    });
    const common = {
      global,
      bondingCurveAccountInfo: state.bondingCurveAccountInfo,
      bondingCurve: state.bondingCurve,
      mint,
      user: owner,
      amount,
      slippage: slippagePercent,
      tokenProgram,
    };
    const instructions = quoteOnly
      ? []
      : solQuoted
        ? await pump.PUMP_SDK.sellInstructions({ ...common, solAmount: quoteAmount, mayhemMode: state.bondingCurve.isMayhemMode, cashback: state.bondingCurve.isCashbackCoin })
        : await pump.PUMP_SDK.sellV2Instructions({ ...common, quoteAmount, quoteTokenProgram: state.quoteTokenProgram });
    const min = quoteAmount.sub(quoteAmount.mul(permille(slippagePercent)).div(new BN(1000)));
    return { venue: "curve", instructions, expectedQuoteRaw: big(quoteAmount), minQuoteRaw: big(min), ata: ataOf(owner, mint, tokenProgram) };
  }

  const online = new amm.OnlinePumpAmmSdk(conn);
  const state = await online.swapSolanaState(market.poolKey, owner).catch(() => null);
  if (!state) throw new TradeError("This token has no pool to trade in.", "no_market");
  const quote = amm.sellBaseInput({
    base: amount,
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
  const instructions = quoteOnly ? [] : await amm.PUMP_AMM_SDK.sellBaseInput(state, amount, slippagePercent);
  return { venue: "amm", instructions, expectedQuoteRaw: big(quote.uiQuote), minQuoteRaw: big(quote.minQuote), ata: state.userBaseTokenAccount };
}
