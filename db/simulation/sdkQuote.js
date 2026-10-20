import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { getSolUsd, pickRpcUrl, rpc } from "../onchainPrice.js";
import { prepareBuy, prepareSell, TradeError } from "../live/trading/pumpSwap.js";
import { pumpSdks } from "../live/trading/sdk.js";
import { getPrice, PRICE_MAX_AGE } from "../pumpFunApi.js";

/**
 * Prices a simulated buy or sell with pump.fun's own SDK instead of reading a spot price: "if I spend X, how many tokens do I
 * get" and "if I sell N tokens, what do I receive" - exactly what the program would do right now, pump.fun's fee and the
 * price impact of our own size included. Used by wallets whose trades are detected through the pump.fun API
 * (Wallet.settings.trackingMethod === "api"), for their fills and for the stop-loss / take-profit checks.
 *
 * Nothing is sent and nothing needs to be owned: the SDK's quote functions are pure maths over the curve's (or pool's)
 * current reserves, which are read from the chain (db/live/trading/pumpSwap.js does the reading for a single token; the sweep
 * below reads many curves in one RPC call).
 *
 * Returned amounts are plain numbers in UI units (tokens) and USD. A quote that can't be made throws (TradeError for "this
 * token can't be priced" - no market, not quoted in SOL; any other error is a network problem worth retrying).
 *
 * A few tokens can't be quoted by the SDK's SOL functions at all (a curve quoted in another pump token, say). Rather than quietly
 * skipping them - which would make an API wallet trade a different set of tokens than a logs wallet - priceBuy / priceSell /
 * valueMany fall back to the spot price (db/pumpFunApi.js getPrice) for exactly those, and say so in `method`: "spot" fills have no
 * fee in the number and still pay the wallet's pump-fee setting, "sdk" fills already have pump.fun's fee inside the quote.
 */

/** Every pump.fun token has 6 decimals (the program creates the mint). */
const PUMP_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1e9;
/** Quotes need an owner address only to look up its token account, which a quote ignores - any valid address will do. */
const QUOTE_OWNER = SystemProgram.programId;
const GLOBAL_TTL_MS = 60_000;

const usdOf = (lamports, solUsd) => (Number(lamports) / LAMPORTS_PER_SOL) * solUsd;

async function freshSolUsd() {
  const solUsd = await getSolUsd({ maxAgeMs: 0 });
  if (!solUsd) throw new Error("SOL/USD price unavailable");
  return solUsd;
}

/**
 * What spending `spendUsd` buys right now (the SDK takes the budget INCLUDING pump.fun's fee).
 * @returns {Promise<{ tokenAmount: number, priceUsd: number, solUsd: number, venue: "curve"|"amm" }>} priceUsd is the effective price paid per token, fee and price impact included
 */
export async function quoteBuy(mint, spendUsd) {
  const solUsd = await freshSolUsd();
  const budgetLamports = BigInt(Math.floor((spendUsd / solUsd) * LAMPORTS_PER_SOL));
  const quote = await prepareBuy({ owner: QUOTE_OWNER, mint, budgetLamports, slippagePercent: 0, quoteOnly: true });
  if (quote.decimals !== PUMP_DECIMALS) throw new TradeError("Unexpected token decimals.", "no_market");
  const tokenAmount = Number(quote.expectedTokenRaw) / 10 ** PUMP_DECIMALS;
  if (!(tokenAmount > 0)) throw new TradeError("The amount is too small to buy any of this token.", "bad_amount");
  return { tokenAmount, priceUsd: spendUsd / tokenAmount, solUsd, venue: quote.venue };
}

const rawOf = (tokenAmount) => BigInt(Math.round(tokenAmount * 10 ** PUMP_DECIMALS));

/**
 * What selling `tokenAmount` receives right now, after pump.fun's fee.
 * @returns {Promise<{ proceedsUsd: number, priceUsd: number, solUsd: number, venue: "curve"|"amm" }>} priceUsd is the effective price per token
 */
export async function quoteSell(mint, tokenAmount, { solUsd } = {}) {
  const sol = solUsd ?? (await freshSolUsd());
  const quote = await prepareSell({ owner: QUOTE_OWNER, mint, tokenRaw: rawOf(tokenAmount), slippagePercent: 0, quoteOnly: true });
  if (quote.decimals !== PUMP_DECIMALS) throw new TradeError("Unexpected token decimals.", "no_market");
  const proceedsUsd = usdOf(quote.expectedLamports, sol);
  return { proceedsUsd, priceUsd: proceedsUsd / tokenAmount, solUsd: sol, venue: quote.venue };
}

/** A token the SDK can't quote (as opposed to a network error, which should be retried). */
const isUnquotable = (err) => err instanceof TradeError && (err.code === "unsupported_quote" || err.code === "no_market");

/**
 * The price a simulated BUY of `spendUsd` fills at. null = no price could be read right now (retry later).
 * @returns {Promise<{ tokenAmount: number, priceUsd: number, method: "sdk"|"spot" } | null>}
 */
export async function priceBuy(mint, spendUsd) {
  try {
    const q = await quoteBuy(mint, spendUsd);
    return { tokenAmount: q.tokenAmount, priceUsd: q.priceUsd, method: "sdk" };
  } catch (err) {
    if (!isUnquotable(err)) throw err;
  }
  const spot = await getPrice(mint, { fresh: true });
  return spot?.priceUsd ? { tokenAmount: spendUsd / spot.priceUsd, priceUsd: spot.priceUsd, method: "spot" } : null;
}

/**
 * The price a simulated SELL of `tokenAmount` fills at (the effective price per token). null = no price right now (retry later).
 * @returns {Promise<{ priceUsd: number, method: "sdk"|"spot" } | null>}
 */
export async function priceSell(mint, tokenAmount) {
  try {
    const q = await quoteSell(mint, tokenAmount);
    return { priceUsd: q.priceUsd, method: "sdk" };
  } catch (err) {
    if (!isUnquotable(err)) throw err;
  }
  const spot = await getPrice(mint, { fresh: true });
  return spot?.priceUsd ? { priceUsd: spot.priceUsd, method: "spot" } : null;
}

// ------------------------------------------------------------- the sweep

let globals = { value: null, expiresAt: 0 };

/** The pump program's Global and FeeConfig accounts (fee rates and tiers) - they change rarely, so they're read once a minute. */
async function curveParams(conn) {
  if (globals.value && globals.expiresAt > Date.now()) return globals.value;
  const online = new (pumpSdks().pump.OnlinePumpSdk)(conn);
  const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
  globals = { value: { global, feeConfig }, expiresAt: Date.now() + GLOBAL_TTL_MS };
  return globals.value;
}

/** address -> AccountInfo-shaped object | null, 100 accounts per call, "processed" for the freshest state. */
async function fetchAccounts(addresses) {
  const out = new Map();
  for (let i = 0; i < addresses.length; i += 100) {
    const chunk = addresses.slice(i, i + 100);
    const result = await rpc("getMultipleAccounts", [chunk, { encoding: "base64", commitment: "processed" }]);
    result.value.forEach((acc, idx) => {
      out.set(
        chunk[idx],
        acc ? { data: Buffer.from(acc.data[0], "base64"), owner: new PublicKey(acc.owner), lamports: acc.lamports, executable: acc.executable } : null
      );
    });
  }
  return out;
}

/**
 * Values many holdings at once for a risk sweep: what each would receive if sold right now. Tokens still on their bonding curve are
 * priced from ONE batched account read (the curve's reserves) plus the SDK's own sell maths; anything else (graduated to a
 * PumpSwap pool) goes through the single-token quote. A holding that can't be priced right now (network trouble) maps to null and
 * simply isn't checked this sweep; one the SDK can't quote at all is valued at the spot price, marked method "spot".
 * @param {{ id: string, mint: string, tokenAmount: number }[]} items
 * @returns {Promise<Map<string, { valueUsd: number, method: "sdk"|"spot" } | null>>}
 */
export async function valueMany(items) {
  const result = new Map(items.map((item) => [item.id, null]));
  if (items.length === 0) return result;

  const { pump } = pumpSdks();
  const solUsd = await getSolUsd({ maxAgeMs: 5000 });
  if (!solUsd) return result;

  const mints = [...new Set(items.map((item) => item.mint))];
  const curvePda = new Map(mints.map((mint) => [mint, pump.bondingCurvePda(mint).toBase58()]));
  let accounts;
  let params;
  try {
    [accounts, params] = await Promise.all([fetchAccounts([...curvePda.values()]), curveParams(new Connection(await pickRpcUrl(), "confirmed"))]);
  } catch {
    return result; // RPC trouble: nothing is checked this sweep, the next one tries again
  }

  const curveOf = new Map();
  for (const mint of mints) {
    const info = accounts.get(curvePda.get(mint));
    const curve = info ? safeDecode(pump, info) : null;
    const quote = curve && !curve.complete && !pump.isBondingCurveMigrated(curve) ? pump.normalizeQuoteMint(curve.quoteMint) : null;
    if (curve && quote && pump.isSolLikeQuoteMint(quote)) curveOf.set(mint, curve);
  }

  await Promise.all(
    items.map(async (item) => {
      const curve = curveOf.get(item.mint);
      try {
        if (curve) {
          const lamports = pump.getSellSolAmountFromTokenAmount({
            global: params.global,
            feeConfig: params.feeConfig,
            mintSupply: curve.tokenTotalSupply,
            bondingCurve: curve,
            amount: new BN(rawOf(item.tokenAmount).toString()),
            quoteTransferFee: null,
          });
          result.set(item.id, { valueUsd: usdOf(lamports.toString(), solUsd), method: "sdk" });
        } else {
          const quote = await quoteSell(item.mint, item.tokenAmount, { solUsd });
          result.set(item.id, { valueUsd: quote.proceedsUsd, method: "sdk" });
        }
      } catch (err) {
        if (!isUnquotable(err)) return; // network trouble: left null, not checked this sweep
        const spot = await getPrice(item.mint, { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP }).catch(() => null);
        if (spot?.priceUsd) result.set(item.id, { valueUsd: item.tokenAmount * spot.priceUsd, method: "spot" });
      }
    })
  );
  return result;
}

function safeDecode(pump, info) {
  try {
    return pump.PUMP_SDK.decodeBondingCurveNullable(info);
  } catch {
    return null;
  }
}
