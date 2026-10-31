import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { rpc } from "../onchainPrice.js";
import { BurnError, waitForConfirmation } from "./burnTokenAccount.js";
import { base58Encode } from "./walletKeys.js";

/**
 * Sends SOL from one wallet's key to another address, in one plain transaction. Standalone like burnTokenAccount.js (a key and an address, no
 * database), which also supplies its error type and confirmation wait. Whether the destination is allowed is the caller's to decide - the live-wallet
 * wrapper (db/live/service.js) only ever passes the address of another wallet on this platform.
 */

export const TRANSFER_FEE_LAMPORTS = 5000; // one signature, no priority fee
export const RENT_EXEMPT_MIN_LAMPORTS = 890_880; // what an account holding no data must keep to stay open

/** Reads "1.25" (SOL) as lamports without floating point. Returns null when it isn't a positive amount with at most 9 decimals. */
export function parseSolToLamports(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,9})(?:\.(\d{1,9}))?$/.exec(text);
  if (!match) return null;
  const lamports = BigInt(match[1]) * 1_000_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
  return lamports > 0n && lamports <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(lamports) : null;
}

/**
 * @param {{ secretKey: Uint8Array | Buffer, to: string, lamports?: number, all?: boolean }} options all = everything but the network fee (the wallet is left at zero)
 * @returns {Promise<{ signature: string, status: "confirmed" | "pending", from: string, to: string, lamports: number, feeLamports: number }>}
 * @throws {BurnError} with a message fit to show the user
 */
export async function transferSol({ secretKey, to, lamports, all = false }) {
  let keypair;
  try {
    keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    throw new BurnError("The wallet's key couldn't be used.", 500);
  }
  let destination;
  try {
    destination = new PublicKey(to);
  } catch {
    throw new BurnError("Invalid destination address.");
  }
  const from = keypair.publicKey.toBase58();
  if (destination.toBase58() === from) throw new BurnError("Choose a different wallet to send to.");

  const balance = (await rpc("getBalance", [from, { commitment: "confirmed" }])).value;
  const destinationBalance = (await rpc("getBalance", [destination.toBase58(), { commitment: "confirmed" }])).value;
  const amount = all ? balance - TRANSFER_FEE_LAMPORTS : lamports;
  if (!(amount > 0)) throw new BurnError("There is nothing to send: the balance doesn't cover the network fee.", 409);
  if (amount + TRANSFER_FEE_LAMPORTS > balance) throw new BurnError(`Not enough SOL: the wallet holds ${(balance / 1e9).toFixed(6)} SOL and needs the amount plus a ${TRANSFER_FEE_LAMPORTS / 1e9} SOL network fee.`, 409);
  const left = balance - amount - TRANSFER_FEE_LAMPORTS;
  if (left > 0 && left < RENT_EXEMPT_MIN_LAMPORTS) {
    throw new BurnError(`The wallet must keep at least ${RENT_EXEMPT_MIN_LAMPORTS / 1e9} SOL or be emptied completely (this would leave ${(left / 1e9).toFixed(6)} SOL). Send less, or use Max.`, 409);
  }
  if (destinationBalance + amount < RENT_EXEMPT_MIN_LAMPORTS) throw new BurnError(`The receiving wallet would hold less than ${RENT_EXEMPT_MIN_LAMPORTS / 1e9} SOL, which the network doesn't accept. Send at least ${((RENT_EXEMPT_MIN_LAMPORTS - destinationBalance) / 1e9).toFixed(6)} SOL.`, 409);

  const { value: latest } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const transaction = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  transaction.add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: destination, lamports: amount }));
  transaction.sign(keypair);
  const signature = base58Encode(transaction.signature);

  try {
    await rpc("sendTransaction", [transaction.serialize().toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  } catch (err) {
    // The RPC may have taken the transaction and then failed to answer: if the chain knows this signature, carry on.
    const statuses = await rpc("getSignatureStatuses", [[signature]]).catch(() => null);
    if (!statuses?.value?.[0] || statuses.value[0].err) throw new BurnError(String(err instanceof Error ? err.message : err).replace(/^sendTransaction: /, "").slice(0, 300) || "The transfer failed.", 422);
  }
  const outcome = await waitForConfirmation(signature, latest.lastValidBlockHeight);
  if (outcome === "expired") throw new BurnError("The network was too slow and the transaction expired. Nothing was sent - try again.", 504);
  return { signature, status: outcome, from, to: destination.toBase58(), lamports: amount, feeLamports: TRANSFER_FEE_LAMPORTS };
}
