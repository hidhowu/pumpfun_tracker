import { rpc } from "../../onchainPrice.js";

/**
 * What a confirmed trade REALLY did to the wallet, read from the transaction on the chain - never from the quote. The wallet's SOL before and
 * after, the network fee and the token balance change give the exact amounts, so the profit and loss of a live trade is accurate to the lamport.
 *
 *   buy : swapLamports = SOL the swap spent (pump.fun's fee included) = -(SOL change) - network fee - tip - rent of a token account it opened
 *   sell: swapLamports = SOL the swap paid out after pump.fun's fee    =   SOL change  + network fee + tip
 *
 * The rent is the deposit for a token account the trade opened; it is returned when that account is burned, so it is reported on its own and
 * is not a cost. Wrapped SOL that was already in the wallet and gets unwrapped by the same transaction is not counted as swap money either.
 */

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const FETCH_ATTEMPTS = 10;
const FETCH_GAP_MS = 700;

export class OutcomeError extends Error {}

/** @returns {Promise<object | null>} the parsed transaction, or null if the RPC doesn't have it (yet) */
async function fetchTransaction(signature) {
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const tx = await rpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null);
    if (tx) return tx;
    await new Promise((resolve) => setTimeout(resolve, FETCH_GAP_MS));
  }
  return null;
}

/**
 * @param {{ signature: string, owner: string, mint: string, side: "buy" | "sell", tipLamports: number, outMint?: string | null }} options
 *   outMint: a sale that does not end in SOL (one stage of a sale down a chain of quote tokens, db/live/trading/sellChain.js) pays out this token instead:
 *   its balance change is reported as outDeltaRaw and the SOL change is not swap money (it is the fee and the deposit of the accounts opened).
 * @returns {Promise<{ failed: true, error: string } | { failed: false, signature: string, slot: number, blockTime: number | null, swapLamports: number,
 *   feeLamports: number, tipLamports: number, rentLamports: number, tokenDeltaRaw: bigint, tokenAfterRaw: bigint, outDeltaRaw: bigint }>}
 */
export async function readTradeOutcome({ signature, owner, mint, side, tipLamports, outMint = null }) {
  const tx = await fetchTransaction(signature);
  if (!tx) throw new OutcomeError("The confirmed transaction couldn't be read from the chain yet.");
  const meta = tx.meta;
  if (meta?.err) return { failed: true, error: JSON.stringify(meta.err) };

  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const index = keys.indexOf(owner);
  if (index < 0) throw new OutcomeError("The wallet isn't part of that transaction.");
  const solChange = meta.postBalances[index] - meta.preBalances[index]; // lamports, signed; the fee is already inside it

  const mine = (balances, wanted) => (balances ?? []).filter((b) => b.owner === owner && b.mint === wanted);
  const sum = (list) => list.reduce((total, b) => total + BigInt(b.uiTokenAmount.amount), 0n);
  const before = mine(meta.preTokenBalances, mint);
  const after = mine(meta.postTokenBalances, mint);
  const tokenDeltaRaw = sum(after) - sum(before);

  // The deposit of every token account this transaction opened for the wallet (it has no "before" entry): the traded token's, and the quote
  // token's when SOL was turned into it on the way. A wrapped-SOL account is a temporary one, closed in the same transaction.
  const ownedBefore = new Set((meta.preTokenBalances ?? []).filter((b) => b.owner === owner).map((b) => b.accountIndex));
  const rentLamports = (meta.postTokenBalances ?? [])
    .filter((b) => b.owner === owner && b.mint !== WSOL_MINT && !ownedBefore.has(b.accountIndex))
    .reduce((total, b) => total + meta.postBalances[b.accountIndex], 0);

  // Wrapped SOL the wallet already held in a token account this transaction closed: it comes back as SOL but is not swap money.
  const unwrapped = mine(meta.preTokenBalances, WSOL_MINT)
    .filter((b) => meta.postBalances[b.accountIndex] === 0)
    .reduce((total, b) => total + meta.preBalances[b.accountIndex], 0);

  const feeLamports = meta.fee;
  const adjustedChange = solChange - unwrapped;
  const outDeltaRaw = outMint ? sum(mine(meta.postTokenBalances, outMint)) - sum(mine(meta.preTokenBalances, outMint)) : 0n;
  const swapLamports = outMint ? 0 : side === "buy" ? -adjustedChange - feeLamports - tipLamports - rentLamports : adjustedChange + feeLamports + tipLamports;

  if (side === "buy" && tokenDeltaRaw <= 0n) throw new OutcomeError("The confirmed buy didn't add any tokens to the wallet.");
  if (side === "sell" && tokenDeltaRaw >= 0n) throw new OutcomeError("The confirmed sell didn't take any tokens out of the wallet.");
  if (outMint && outDeltaRaw <= 0n) throw new OutcomeError("The confirmed sell didn't pay out any of the token it was meant to end in.");
  if (swapLamports < 0) throw new OutcomeError("The amounts in the confirmed transaction don't add up.");

  return {
    failed: false,
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    swapLamports,
    feeLamports,
    tipLamports,
    rentLamports,
    tokenDeltaRaw,
    tokenAfterRaw: sum(after),
    outDeltaRaw,
  };
}
