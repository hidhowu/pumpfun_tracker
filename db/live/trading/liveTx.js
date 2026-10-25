import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { rpc } from "../../onchainPrice.js";
import { base58Encode } from "../walletKeys.js";
import { inflightStatus, sendBundle, tipInstruction } from "./jito.js";

/**
 * Builds, signs and lands ONE transaction, either through Jito or as a plain Solana transaction, and tells exactly what became of it.
 *
 *  - "jito": a one-transaction bundle with a tip (a refused trade never lands, so it costs nothing).
 *  - "raw":  the transaction goes to the RPC nodes with a small priority fee and no tip (cheaper; a refused trade still pays its network fee).
 *
 * The signed transaction is returned BEFORE anything is sent, so the caller can store it first: whatever happens after (a crash, a lost answer),
 * the same signature can be looked up again, and the same transaction offered again - it can only ever land once. A new transaction (new blockhash)
 * is built only after the old one has expired for good, so a trade can never happen twice.
 *
 * It is always a version-0 transaction, so address lookup tables (db/live/trading/lookupTable.js) can shrink the bigger swaps to fit.
 */

// Jito's sandwich guard: any account whose address starts with "jitodontfront" makes a bundle valid only when this transaction is first in it
// - a single-transaction bundle always is, so this only refuses bundles an attacker built AROUND ours (front-running a copy trade).
const SANDWICH_GUARD = new PublicKey("jitodontfront111111111111111111111111111111");
export const DEFAULT_COMPUTE_UNITS = 300_000; // a limit, not a price: without a priority fee the unused part costs nothing
const OFFER_EVERY_MS = { jito: 2500, raw: 1500 }; // the same signed transaction is offered again this often while it hasn't landed
const POLL_MS = 400;
const MAX_WAIT_MS = 100_000;
export const SIZE_LIMIT = 1232;

export class SendError extends Error {
  constructor(message, kind = "failed") {
    super(message);
    this.kind = kind; // "failed" (it landed and reverted), "expired" (never landed, now can't), "too_big", "pending" (still unknown after a long wait)
  }
}

/**
 * @param {{ keypair: import("@solana/web3.js").Keypair, instructions: import("@solana/web3.js").TransactionInstruction[], sendMode: "raw" | "jito",
 *   tipLamports?: number, priorityMicroLamports?: number, computeUnits?: number, lookupTables?: import("@solana/web3.js").AddressLookupTableAccount[] }} options
 * @returns {Promise<{ signature: string, raw: string, blockhash: string, lastValidBlockHeight: number, tipLamports: number, sendMode: string, computeUnits: number, priorityMicroLamports: number }>}
 */
export async function buildSignedTrade({ keypair, instructions, sendMode, tipLamports = 0, priorityMicroLamports = 0, computeUnits = DEFAULT_COMPUTE_UNITS, lookupTables = [] }) {
  const { value: latest } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const jito = sendMode === "jito";
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })];
  if (!jito && priorityMicroLamports > 0) budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }));
  let tip = null;
  if (jito) {
    tip = tipInstruction(keypair.publicKey, tipLamports);
    tip.keys.push({ pubkey: SANDWICH_GUARD, isSigner: false, isWritable: false });
  }

  let tx;
  try {
    // Tables that hold nothing this transaction uses are dropped by the compiler, so every known table can be passed.
    tx = new VersionedTransaction(new TransactionMessage({ payerKey: keypair.publicKey, recentBlockhash: latest.blockhash, instructions: [...budget, ...instructions, ...(tip ? [tip] : [])] }).compileToV0Message(lookupTables));
    tx.sign([keypair]);
  } catch (err) {
    throw new SendError(`The transaction can't be built (${/overruns|too large|encoding/i.test(String(err.message)) ? "too large" : err.message}).`, "too_big");
  }
  const bytes = tx.serialize();
  if (bytes.length > SIZE_LIMIT) throw new SendError(`The transaction is too large to send (${bytes.length} of ${SIZE_LIMIT} bytes).`, "too_big");
  return {
    signature: base58Encode(tx.signatures[0]),
    raw: Buffer.from(bytes).toString("base64"),
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    tipLamports: tip ? Number(tip.data.readBigUInt64LE(4)) : 0,
    sendMode: jito ? "jito" : "raw",
    computeUnits,
    priorityMicroLamports: jito ? 0 : priorityMicroLamports,
  };
}

/**
 * Would these instructions, with the compute budget and (in Jito mode) the tip, fit one transaction? Sized the way buildSignedTrade builds it.
 * @param {{ payer: PublicKey, instructions: object[], lookupTables?: object[], sendMode?: "raw" | "jito" }} options
 */
export function fitsTransaction({ payer, instructions, lookupTables = [], sendMode = "jito" }) {
  try {
    const extra = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })];
    if (sendMode === "jito") {
      const tip = tipInstruction(payer, 1);
      tip.keys.push({ pubkey: SANDWICH_GUARD, isSigner: false, isWritable: false });
      extra.push(tip);
    }
    const message = new TransactionMessage({ payerKey: payer, recentBlockhash: PublicKey.default.toBase58(), instructions: [...extra, ...instructions] }).compileToV0Message(lookupTables);
    return new VersionedTransaction(message).serialize().length <= SIZE_LIMIT;
  } catch {
    return false;
  }
}

async function statusOf(signature) {
  const result = await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]).catch(() => null);
  return result?.value?.[0] ?? null;
}

/** One offer of the signed transaction. Returns the Jito bundle id (jito) or null (raw). */
async function offer(signed) {
  if (signed.sendMode === "raw") {
    // No preflight: the RPC accepts it at once (fastest). maxRetries 0: this loop re-offers it, so the node's own rebroadcasts would only blur the timings.
    await rpc("sendTransaction", [signed.raw, { encoding: "base64", skipPreflight: true, maxRetries: 0 }]);
    return { bundleId: null, engine: null };
  }
  return sendBundle(signed.raw);
}

/**
 * Offers the signed transaction (again every second or two) until it is confirmed, reverted, or can no longer land.
 * `onOffered(bundleId, engine)` is called after the first successful offer (for the log).
 * @returns {Promise<{ status: "confirmed", signature: string, bundleId: string | null, sentAt: number, landedAt: number }>}
 *   sentAt / landedAt are wall-clock ms: when it was first offered (null if it was found already landed, e.g. after a restart), and when it was first seen on the chain (processed or better).
 * @throws {SendError} kind "failed" - it landed but the program refused it; "expired" - it never landed and now never can; "pending" - unknown after a long wait
 */
export async function landTrade(signed, { onOffered } = {}) {
  const startedAt = Date.now();
  const every = OFFER_EVERY_MS[signed.sendMode] ?? OFFER_EVERY_MS.jito;
  let bundleId = null;
  let lastOffer = 0;
  let offerError = null;
  let sentAt = null;
  let landedAt = null;
  let offered = false;

  const result = () => ({ status: "confirmed", signature: signed.signature, bundleId, sentAt, landedAt });

  while (true) {
    const status = await statusOf(signed.signature);
    if (status && landedAt == null) landedAt = Date.now();
    if (status?.err) throw Object.assign(new SendError(`The trade was refused by the program: ${JSON.stringify(status.err)}`, "failed"), { sentAt, landedAt });
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return result();

    const now = Date.now();
    if (now - lastOffer >= every) {
      lastOffer = now;
      if (sentAt == null) sentAt = now;
      try {
        const sent = await offer(signed);
        if (!offered) {
          offered = true;
          bundleId = sent.bundleId;
          onOffered?.(sent.bundleId, sent.engine);
        }
        offerError = null;
      } catch (err) {
        offerError = err;
      }
    }

    const height = await rpc("getBlockHeight", [{ commitment: "confirmed" }]).catch(() => 0);
    if (height > signed.lastValidBlockHeight) {
      // One last look: it may have landed in the final blocks.
      const final = await statusOf(signed.signature);
      if (final && landedAt == null) landedAt = Date.now();
      if (final?.err) throw Object.assign(new SendError(`The trade was refused by the program: ${JSON.stringify(final.err)}`, "failed"), { sentAt, landedAt });
      if (final && (final.confirmationStatus === "confirmed" || final.confirmationStatus === "finalized")) return result();
      const why = offerError ? ` (${offerError.message})` : bundleId ? ` (Jito says: ${(await inflightStatus(bundleId)) ?? "unknown"})` : "";
      throw Object.assign(new SendError(`The trade didn't land before its blockhash expired${why}.`, "expired"), { sentAt });
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw Object.assign(new SendError("The trade is still not confirmed after a long wait - it will be checked again.", "pending"), { sentAt });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** True once the chain can no longer accept this transaction (its blockhash has expired): only then may a fresh one be built. */
export async function hasExpired(signed) {
  const height = await rpc("getBlockHeight", [{ commitment: "confirmed" }]).catch(() => 0);
  return height > signed.lastValidBlockHeight;
}

export { statusOf as signatureStatus };
