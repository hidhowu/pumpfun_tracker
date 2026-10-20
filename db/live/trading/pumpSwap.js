import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { pickRpcUrl } from "../../onchainPrice.js";
import { pumpSdks } from "./sdk.js";

/**
 * Builds the swap instructions for buying and selling a pump.fun token with SOL - on the bonding curve while the token is still on
 * it, and in its PumpSwap pool once it has graduated - using pump.fun's own SDKs, so the account lists follow the programs.
 * Nothing here sends anything: every function returns instructions plus what the trade is expected to give, and the caller
 * decides whether to sign and send them (live) or only record the expectation (dry run).
 *
 * Amounts are in raw units (lamports for SOL, the token's smallest unit for tokens) and travel as BigInt.
 * `slippagePercent` is the price move the trade tolerates before the program refuses it (1 = 1%): a buy may cost up to that
 * much more than quoted, a sell may pay up to that much less. A refused trade costs nothing but the network fee.
 */

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export class TradeError extends Error {
  /** @param {string} message @param {string} [code] short machine-readable reason, e.g. "no_market" */
  constructor(message, code = "trade_failed") {
    super(message);
    this.code = code;
  }
}

async function connection() {
  return new Connection(await pickRpcUrl(), "confirmed");
}

const bn = (value) => new BN(value.toString());
const big = (value) => BigInt(value.toString());

/**
 * Where a token trades right now: "curve" (still on its bonding curve) or "amm" (graduated to its PumpSwap pool), with its
 * token program (classic or Token-2022) and decimals. A token pump.fun doesn't know is a TradeError.
 */
export async function getMarket(mint, conn) {
  const { pump } = pumpSdks();
  const connection_ = conn ?? (await connection());
  const mintKey = new PublicKey(mint);
  const [mintInfo, curve] = await Promise.all([
    connection_.getAccountInfo(mintKey, "confirmed"),
    new pump.OnlinePumpSdk(connection_).fetchBondingCurve(mintKey).catch(() => null),
  ]);
  if (!mintInfo) throw new TradeError("That token doesn't exist on the chain.", "no_market");
  const owner = mintInfo.owner.toBase58();
  if (owner !== TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) throw new TradeError("That isn't a token.", "no_market");
  const base = { mint, tokenProgram: mintInfo.owner, decimals: mintInfo.data[44], conn: connection_ };
  if (curve && !pump.isBondingCurveMigrated(curve) && !curve.complete) return { ...base, venue: "curve" };
  return { ...base, venue: "amm" };
}

/**
 * @param {{ owner: PublicKey, mint: string, budgetLamports: bigint | number, slippagePercent: number, quoteOnly?: boolean }} options
 *   budgetLamports is what the swap may spend INCLUDING pump.fun's own fee.
 *   quoteOnly: only price the purchase (the simulation's API mode); no instructions are built, so `owner` can be any address.
 * @returns {Promise<{ venue: "curve"|"amm", instructions: import("@solana/web3.js").TransactionInstruction[], expectedTokenRaw: bigint,
 *   maxCostLamports: bigint, tokenProgram: PublicKey, decimals: number, ata: PublicKey, createsAta: boolean }>}
 */
export async function prepareBuy({ owner, mint, budgetLamports, slippagePercent, quoteOnly = false }) {
  const { pump, amm } = pumpSdks();
  const market = await getMarket(mint);
  const mintKey = new PublicKey(mint);
  const budget = bn(budgetLamports);
  if (budget.lten(0)) throw new TradeError("Nothing to spend.", "bad_amount");

  if (market.venue === "curve") {
    const online = new pump.OnlinePumpSdk(market.conn);
    const [global, feeConfig, state] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchBuyState(mintKey, owner, market.tokenProgram)]);
    if (!pump.isSolLikeQuoteMint(state.quoteMint)) throw new TradeError("This token is quoted in something other than SOL.", "unsupported_quote");
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
    const instructions = quoteOnly ? [] : await pump.PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo: state.bondingCurveAccountInfo,
      bondingCurve: state.bondingCurve,
      associatedUserAccountInfo: state.associatedUserAccountInfo,
      mint: mintKey,
      user: owner,
      amount: tokens,
      solAmount: budget,
      slippage: slippagePercent,
      tokenProgram: market.tokenProgram,
    });
    return {
      venue: "curve",
      instructions,
      expectedTokenRaw: big(tokens),
      maxCostLamports: big(budget.add(budget.mul(new BN(Math.floor(slippagePercent * 10))).div(new BN(1000)))),
      tokenProgram: market.tokenProgram,
      decimals: market.decimals,
      ata: ataOf(owner, mintKey, market.tokenProgram),
      createsAta: !state.associatedUserAccountInfo,
    };
  }

  const online = new amm.OnlinePumpAmmSdk(market.conn);
  const poolKey = pump.canonicalPumpPoolPda(mintKey);
  const state = await online.swapSolanaState(poolKey, owner).catch(() => null);
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
  return {
    venue: "amm",
    instructions,
    expectedTokenRaw: big(quote.base),
    maxCostLamports: big(quote.maxQuote),
    tokenProgram: market.tokenProgram,
    decimals: market.decimals,
    ata: state.userBaseTokenAccount,
    createsAta: !state.userBaseAccountInfo,
  };
}

/**
 * @param {{ owner: PublicKey, mint: string, tokenRaw: bigint | number, slippagePercent: number, quoteOnly?: boolean }} options
 *   quoteOnly: only price the sale (a dry run holds no tokens and has no token account, so there is nothing to build instructions for).
 * @returns {Promise<{ venue: "curve"|"amm", instructions: import("@solana/web3.js").TransactionInstruction[], expectedLamports: bigint,
 *   minLamports: bigint, tokenProgram: PublicKey, decimals: number, ata: PublicKey }>}
 *   expectedLamports is what the sale should pay out after pump.fun's fees; minLamports is the least the program will accept.
 */
export async function prepareSell({ owner, mint, tokenRaw, slippagePercent, quoteOnly = false }) {
  const { pump, amm } = pumpSdks();
  const market = await getMarket(mint);
  const mintKey = new PublicKey(mint);
  const amount = bn(tokenRaw);
  if (amount.lten(0)) throw new TradeError("Nothing to sell.", "bad_amount");

  if (market.venue === "curve") {
    const online = new pump.OnlinePumpSdk(market.conn);
    const [global, feeConfig, state] = await Promise.all([
      online.fetchGlobal(),
      online.fetchFeeConfig(),
      quoteOnly
        ? online.fetchBondingCurve(mintKey).then((bondingCurve) => ({ bondingCurve, quoteMint: pump.normalizeQuoteMint(bondingCurve.quoteMint), quoteTransferFee: null, bondingCurveAccountInfo: null }))
        : online.fetchSellState(mintKey, owner, market.tokenProgram),
    ]);
    if (!pump.isSolLikeQuoteMint(state.quoteMint)) throw new TradeError("This token is quoted in something other than SOL.", "unsupported_quote");
    const solAmount = pump.getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply: state.bondingCurve.tokenTotalSupply,
      bondingCurve: state.bondingCurve,
      amount,
      quoteTransferFee: state.quoteTransferFee,
    });
    const instructions = quoteOnly ? [] : await pump.PUMP_SDK.sellInstructions({
      global,
      bondingCurveAccountInfo: state.bondingCurveAccountInfo,
      bondingCurve: state.bondingCurve,
      mint: mintKey,
      user: owner,
      amount,
      solAmount,
      slippage: slippagePercent,
      tokenProgram: market.tokenProgram,
      mayhemMode: state.bondingCurve.isMayhemMode,
      cashback: state.bondingCurve.isCashbackCoin,
    });
    const min = solAmount.sub(solAmount.mul(new BN(Math.floor(slippagePercent * 10))).div(new BN(1000)));
    return { venue: "curve", instructions, expectedLamports: big(solAmount), minLamports: big(min), tokenProgram: market.tokenProgram, decimals: market.decimals, ata: ataOf(owner, mintKey, market.tokenProgram) };
  }

  const online = new amm.OnlinePumpAmmSdk(market.conn);
  const poolKey = pump.canonicalPumpPoolPda(mintKey);
  const state = await online.swapSolanaState(poolKey, owner).catch(() => null);
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
  return {
    venue: "amm",
    instructions,
    expectedLamports: big(quote.uiQuote),
    minLamports: big(quote.minQuote),
    tokenProgram: market.tokenProgram,
    decimals: market.decimals,
    ata: state.userBaseTokenAccount,
  };
}

function ataOf(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0];
}
