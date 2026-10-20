import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { rpc } from "../onchainPrice.js";
import { base58Encode } from "./walletKeys.js";

/**
 * Burns whatever a token account holds and closes the account, returning its rent deposit to the owner - in ONE transaction,
 * so it either happens completely or not at all. Standalone on purpose: it needs only a signing key and a token account
 * address (no database, no wallet model), so any part of the app can use it. See db/live/service.js for the live-wallet wrapper.
 *
 * What it does, in order:
 *  1. reads the account from the chain and checks it really belongs to the key's address (never trusts what the caller says it holds);
 *  2. builds [BurnChecked for the full balance] + [CloseAccount -> rent goes back to the owner]. A wrapped-SOL account
 *     skips the burn: closing it just unwraps its SOL back to the owner;
 *  3. signs, sends (the RPC simulates it first, so a doomed transaction is rejected without costing a fee) and waits for confirmation.
 * Works for both token programs (classic SPL Token and Token-2022) - the two instructions are identical in both.
 */

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const CONFIRM_TIMEOUT_MS = 45_000;
const POLL_MS = 1_000;

export class BurnError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The chain's error text, in words a person can act on. */
function explain(message) {
  const text = String(message ?? "");
  if (/0x11\b/.test(text)) return "This token account is frozen by the token's issuer, so it can't be burned or closed.";
  if (/0xb\b/.test(text)) return "The account still holds tokens and couldn't be emptied.";
  if (/insufficient (funds|lamports)|no record of a prior credit/i.test(text)) return "Not enough SOL in the wallet to pay the network fee.";
  if (/withheld|0x1f|0x2[0-9a-f]\b/i.test(text)) return "This token holds fees that must be collected before its account can be closed.";
  if (/blockhash not found|expired/i.test(text)) return "The network was too slow and the transaction expired. Nothing happened - try again.";
  return text.replace(/^sendTransaction: /, "").slice(0, 300) || "The transaction failed.";
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

/** Reads the token account and checks it is one this key may burn and close. */
export async function readAccount(tokenAccount, ownerAddress) {
  const result = await rpc("getAccountInfo", [tokenAccount, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const value = result?.value;
  if (!value) throw new BurnError("That token account doesn't exist (it may already be closed).", 404);
  if (value.owner !== TOKEN_PROGRAM && value.owner !== TOKEN_2022_PROGRAM) throw new BurnError("That isn't a token account.");
  const parsed = value.data?.parsed;
  if (parsed?.type !== "account") throw new BurnError("That isn't a token account.");
  const info = parsed.info;
  if (info.owner !== ownerAddress) throw new BurnError("That token account doesn't belong to this wallet.", 403);
  if (info.state === "frozen") throw new BurnError("This token account is frozen by the token's issuer, so it can't be burned or closed.");
  if (info.closeAuthority && info.closeAuthority !== ownerAddress) throw new BurnError("Someone else holds the right to close this token account.");
  return {
    programId: value.owner,
    mint: info.mint,
    rawAmount: BigInt(info.tokenAmount.amount),
    decimals: info.tokenAmount.decimals,
    uiAmount: Number(info.tokenAmount.uiAmountString),
    lamports: value.lamports,
    isNative: Boolean(info.isNative) || info.mint === WSOL_MINT,
  };
}

/**
 * The instructions only (no network): [BurnChecked for the whole balance, skipped for wrapped SOL and empty accounts] + [CloseAccount].
 * Exported so the exact bytes can be tested against a local Solana VM without sending anything.
 * @param {{ owner: PublicKey, tokenAccount: string, account: { programId: string, mint: string, rawAmount: bigint, decimals: number, isNative: boolean } }} options
 */
export function buildBurnAndCloseInstructions({ owner, tokenAccount, account }) {
  const programId = new PublicKey(account.programId);
  const accountKey = new PublicKey(tokenAccount);
  const instructions = [];
  if (account.rawAmount > 0n && !account.isNative) {
    // BurnChecked (15): amount + the mint's decimals, so a wrong decimals value can never burn the wrong quantity.
    instructions.push(
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: accountKey, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(account.mint), isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([15]), u64(account.rawAmount), Buffer.from([account.decimals])]),
      })
    );
  }
  // CloseAccount (9): the rent deposit goes back to the owner.
  instructions.push(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: accountKey, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    })
  );
  return instructions;
}

async function waitForConfirmation(signature, lastValidBlockHeight) {
  const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const statuses = await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: false }]).catch(() => null);
    const status = statuses?.value?.[0];
    if (status?.err) throw new BurnError(explain(JSON.stringify(status.err)), 422);
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return "confirmed";
    const height = await rpc("getBlockHeight", [{ commitment: "confirmed" }]).catch(() => 0);
    if (height > lastValidBlockHeight) return "expired";
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return "pending";
}

/**
 * @param {{ secretKey: Uint8Array | Buffer, tokenAccount: string }} options secretKey is the 64-byte Solana secret (seed + public key)
 * @returns {Promise<{ signature: string, status: "confirmed" | "pending", mint: string, burnedRaw: string, burned: number, decimals: number, closed: true, reclaimedLamports: number }>}
 *   "pending" means the transaction was sent but not seen confirmed within the wait - it may still land; check the signature.
 * @throws {BurnError} with a message fit to show the user
 */
export async function burnAndCloseTokenAccount({ secretKey, tokenAccount }) {
  let keypair;
  try {
    keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    throw new BurnError("The wallet's key couldn't be used.", 500);
  }
  const owner = keypair.publicKey;
  try {
    new PublicKey(tokenAccount);
  } catch {
    throw new BurnError("Invalid token account address.");
  }

  const account = await readAccount(tokenAccount, owner.toBase58());
  const instructions = buildBurnAndCloseInstructions({ owner, tokenAccount, account });

  const { value: latest } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const transaction = new Transaction({ feePayer: owner, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  transaction.add(...instructions);
  transaction.sign(keypair);
  const signature = base58Encode(transaction.signature);
  const raw = transaction.serialize().toString("base64");

  try {
    await rpc("sendTransaction", [raw, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  } catch (err) {
    // The RPC may have taken the transaction and then failed to answer (the helper retries on another endpoint, which
    // then reports "already processed"). If the chain knows this signature, carry on; otherwise it really failed.
    const statuses = await rpc("getSignatureStatuses", [[signature]]).catch(() => null);
    if (!statuses?.value?.[0] || statuses.value[0].err) throw new BurnError(explain(err instanceof Error ? err.message : err), 422);
  }

  const outcome = await waitForConfirmation(signature, latest.lastValidBlockHeight);
  if (outcome === "expired") throw new BurnError("The network was too slow and the transaction expired. Nothing happened - try again.", 504);

  return {
    signature,
    status: outcome,
    mint: account.mint,
    burnedRaw: account.isNative ? "0" : account.rawAmount.toString(),
    burned: account.isNative ? 0 : account.uiAmount,
    decimals: account.decimals,
    closed: true,
    reclaimedLamports: account.lamports,
  };
}

// ------------------------------------------------------------------ many accounts in one transaction

const SIZE_LIMIT = 1232;
const UNITS_PER_ACCOUNT = 30_000; // generous: a burn + close costs far less, and unused units are not charged for
const BASE_UNITS = 20_000;

/**
 * Burns and closes SEVERAL token accounts of one wallet, packing as many as fit into each transaction (up to `perTransaction`). A normal
 * transaction (no Jito): the network's base fee plus, optionally, a tiny priority fee (`priorityFeeLamports`, spread over the compute units
 * so the whole fee is that amount) - a few thousandths of a dollar at most. Accounts that can't be closed (frozen, someone else's right to close,
 * not the wallet's) are reported in `skipped` and left alone; the rest still go.
 *
 * @param {{ secretKey: Uint8Array | Buffer, tokenAccounts: string[], perTransaction?: number, priorityFeeLamports?: number }} options
 * @returns {Promise<{ transactions: Array<{ signature: string, status: "confirmed" | "pending", accounts: string[], reclaimedLamports: number }>, skipped: Array<{ account: string, reason: string }>, failed: Array<{ accounts: string[], reason: string }> }>}
 */
export async function burnAndCloseMany({ secretKey, tokenAccounts, perTransaction = 10, priorityFeeLamports = 0 }) {
  let keypair;
  try {
    keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    throw new BurnError("The wallet's key couldn't be used.", 500);
  }
  const owner = keypair.publicKey;

  const ready = [];
  const skipped = [];
  for (const tokenAccount of [...new Set(tokenAccounts)]) {
    try {
      new PublicKey(tokenAccount);
      const account = await readAccount(tokenAccount, owner.toBase58());
      ready.push({ tokenAccount, account, instructions: buildBurnAndCloseInstructions({ owner, tokenAccount, account }) });
    } catch (err) {
      skipped.push({ account: tokenAccount, reason: err instanceof Error ? err.message : "unreadable" });
    }
  }

  const transactions = [];
  const failed = [];
  const queue = [...ready];
  while (queue.length > 0) {
    // As many as fit: start with the most allowed and halve until the signed transaction is small enough.
    let count = Math.min(perTransaction, queue.length);
    let built = null;
    while (count >= 1) {
      const group = queue.slice(0, count);
      const { value: latest } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
      const units = BASE_UNITS + UNITS_PER_ACCOUNT * group.length;
      const transaction = new Transaction({ feePayer: owner, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units }));
      if (priorityFeeLamports > 0) transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.ceil((priorityFeeLamports * 1_000_000) / units) }));
      for (const entry of group) transaction.add(...entry.instructions);
      transaction.sign(keypair);
      if (transaction.serialize().length <= SIZE_LIMIT) {
        built = { group, transaction, latest };
        break;
      }
      count = Math.floor(count / 2);
    }
    if (!built) {
      failed.push({ accounts: [queue.shift().tokenAccount], reason: "Too large to send." });
      continue;
    }
    const { group, transaction, latest } = built;
    queue.splice(0, group.length);
    const accounts = group.map((g) => g.tokenAccount);
    const signature = base58Encode(transaction.signature);
    try {
      await rpc("sendTransaction", [transaction.serialize().toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
    } catch (err) {
      const statuses = await rpc("getSignatureStatuses", [[signature]]).catch(() => null);
      if (!statuses?.value?.[0] || statuses.value[0].err) {
        failed.push({ accounts, reason: explain(err instanceof Error ? err.message : err) });
        continue;
      }
    }
    try {
      const outcome = await waitForConfirmation(signature, latest.lastValidBlockHeight);
      if (outcome === "expired") failed.push({ accounts, reason: "The network was too slow and the transaction expired. Nothing happened." });
      else transactions.push({ signature, status: outcome, accounts, reclaimedLamports: group.reduce((total, g) => total + g.account.lamports, 0) });
    } catch (err) {
      failed.push({ accounts, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { transactions, skipped, failed };
}
