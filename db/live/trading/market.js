import { PublicKey } from "@solana/web3.js";
import { pumpSdks } from "./sdk.js";

/**
 * Where a pump.fun token trades and what it is priced in - found with two reads (the mint, and its bonding-curve account), so a trade that
 * can't work is refused before anything is built.
 *
 *  - venue "curve": still on its bonding curve.
 *  - venue "amm":   graduated. The bonding-curve account stays on the chain after graduation and records the token the market is quoted in,
 *                   and the PumpSwap pool's address includes that quote token - so the pool is derived from it (SOL when there is no curve account).
 *  - quote:         null for a SOL-quoted market. Otherwise the token it is quoted in (USDC, PUMP, ...): its mint, token program and decimals.
 *                   Such a market is bought with SOL by turning the SOL into the quote token inside the same transaction (db/live/trading/solRoutes.js).
 */

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const WSOL = new PublicKey(WSOL_MINT);
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export class TradeError extends Error {
  /** @param {string} message @param {string} [code] short machine-readable reason, e.g. "no_market" */
  constructor(message, code = "trade_failed") {
    super(message);
    this.code = code;
  }
}

export function ataOf(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

// A quote token's program and decimals never change, so they are read once.
const quoteTokens = new Map(); // mint -> { mint, program, decimals }

async function quoteTokenOf(conn, quoteMint) {
  const key = quoteMint.toBase58();
  if (!quoteTokens.has(key)) {
    const info = await conn.getAccountInfo(quoteMint, "confirmed");
    if (!info) throw new TradeError(`The quote token ${key} doesn't exist on the chain.`, "no_market");
    quoteTokens.set(key, { mint: quoteMint, program: info.owner, decimals: info.data[44] });
  }
  return quoteTokens.get(key);
}

/** The PumpSwap pool a graduated token trades in, derived from the quote token its curve recorded. */
export function poolKeyOf(mint, curve) {
  const { pump } = pumpSdks();
  return curve ? pump.canonicalPumpPoolPdaWithQuote(mint, pump.normalizeQuoteMint(curve.quoteMint)) : pump.canonicalPumpPoolPda(mint);
}

/**
 * @returns {Promise<{ mint: PublicKey, tokenProgram: PublicKey, decimals: number, venue: "curve" | "amm", curve: object | null,
 *   quote: { mint: PublicKey, program: PublicKey, decimals: number } | null, poolKey: PublicKey | null, conn: import("@solana/web3.js").Connection }>}
 */
export async function resolveMarket(conn, mintStr) {
  const { pump } = pumpSdks();
  let mint;
  try {
    mint = new PublicKey(mintStr);
  } catch {
    throw new TradeError("That isn't a token address.", "no_market");
  }
  const [mintInfo, curve] = await Promise.all([conn.getAccountInfo(mint, "confirmed"), new pump.OnlinePumpSdk(conn).fetchBondingCurve(mint).catch(() => null)]);
  if (!mintInfo) throw new TradeError("That token doesn't exist on the chain.", "no_market");
  const program = mintInfo.owner.toBase58();
  if (program !== TOKEN_PROGRAM && program !== TOKEN_2022_PROGRAM) throw new TradeError("That isn't a token.", "no_market");

  const onCurve = !!curve && !pump.isBondingCurveMigrated(curve) && !curve.complete;
  const quoteMint = curve ? pump.normalizeQuoteMint(curve.quoteMint) : WSOL;
  const quote = pump.isSolLikeQuoteMint(quoteMint) ? null : await quoteTokenOf(conn, quoteMint);
  return {
    mint,
    tokenProgram: mintInfo.owner,
    decimals: mintInfo.data[44],
    venue: onCurve ? "curve" : "amm",
    curve,
    quote,
    poolKey: onCurve ? null : poolKeyOf(mint, curve),
    conn,
  };
}
