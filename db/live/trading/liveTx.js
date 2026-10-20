import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { rpc } from "../../onchainPrice.js";
import { base58Encode } from "../walletKeys.js";
import { inflightStatus, sendBundle, tipInstruction } from "./jito.js";

/**
 * Builds, signs and lands ONE transaction through Jito, and tells exactly what became of it.
 *
 * The signed transaction is returned BEFORE anything is sent, so the caller can store it first: whatever happens after (a crash, a lost answer),
 * the same signature can be looked up again, and the same transaction offered again - it can only ever land once. A new transaction (new blockhash)
 * is built only after the old one has expired for good, so a trade can never happen twice.
 */

// Jito's sandwich guard: any account whose address starts with "jitodontfront" makes a bundle valid only when this transaction is first in it
// - a single-transaction bundle always is, so this only refuses bundles an attacker built AROUND ours (front-running a copy trade).
const SANDWICH_GUARD = new PublicKey("jitodontfront111111111111111111111111111111");
const COMPUTE_UNITS = 300_000; // a limit, not a price: with no priority fee the unused part costs nothing
const OFFER_EVERY_MS = 2500; // the same signed transaction is offered again (to another region) this often while it hasn't landed
const POLL_MS = 600;
const MAX_WAIT_MS = 100_000;
const SIZE_LIMIT = 1232;

export class SendError extends Error {
  constructor(message, kind = "failed") {
    super(message);
    this.kind = kind; // "failed" (it landed and reverted), "expired" (never landed, now can't), "too_big"
  }
}

/** @returns {Promise<{ signature: string, raw: string, blockhash: string, lastValidBlockHeight: number, tipLamports: number }>} */
export async function buildSignedTrade({ keypair, instructions, tipLamports }) {
  const { value: latest } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tip = tipInstruction(keypair.publicKey, tipLamports);
  tip.keys.push({ pubkey: SANDWICH_GUARD, isSigner: false, isWritable: false });

  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }), ...instructions, tip);
  tx.sign(keypair);
  const bytes = tx.serialize();
  if (bytes.length > SIZE_LIMIT) throw new SendError("The transaction is too large to send.", "too_big");
  return { signature: base58Encode(tx.signature), raw: bytes.toString("base64"), blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, tipLamports: Number(tip.data.readBigUInt64LE(4)) };
}

async function statusOf(signature) {
  const result = await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]).catch(() => null);
  return result?.value?.[0] ?? null;
}

/**
 * Offers the signed transaction to Jito (again every few seconds, over the regions) until it is confirmed, reverted, or can no longer land.
 * `onOffered(bundleId, engine)` is called after the first successful offer (for the log).
 * @returns {Promise<{ status: "confirmed", signature: string, bundleId: string | null }>}
 * @throws {SendError} kind "failed" - it landed but the program refused it (nothing was spent but the fee); "expired" - it never landed and now never can
 */
export async function landTrade(signed, { onOffered } = {}) {
  const startedAt = Date.now();
  let bundleId = null;
  let lastOffer = 0;
  let offerError = null;

  while (true) {
    const status = await statusOf(signed.signature);
    if (status?.err) throw new SendError(`The trade was refused by the program: ${JSON.stringify(status.err)}`, "failed");
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { status: "confirmed", signature: signed.signature, bundleId };

    const now = Date.now();
    if (now - lastOffer >= OFFER_EVERY_MS) {
      lastOffer = now;
      try {
        const sent = await sendBundle(signed.raw);
        if (!bundleId) {
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
      if (final?.err) throw new SendError(`The trade was refused by the program: ${JSON.stringify(final.err)}`, "failed");
      if (final && (final.confirmationStatus === "confirmed" || final.confirmationStatus === "finalized")) return { status: "confirmed", signature: signed.signature, bundleId };
      const why = offerError ? ` (${offerError.message})` : bundleId ? ` (Jito says: ${(await inflightStatus(bundleId)) ?? "unknown"})` : "";
      throw new SendError(`The trade didn't land before its blockhash expired${why}.`, "expired");
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new SendError("The trade is still not confirmed after a long wait - it will be checked again.", "pending");
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
