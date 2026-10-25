import { LiveWallet } from "../../models/LiveWallet.js";
import { LiveLot } from "../../models/LiveLot.js";
import { LiveExecution } from "../../models/LiveExecution.js";
import { rpc } from "../../onchainPrice.js";
import { logEvent } from "../../systemLog.js";
import { invalidateChainSnapshot } from "../chain.js";
import { burnAndCloseMany } from "../burnTokenAccount.js";
import { base58Decode, base58Encode, decryptWalletSecret } from "../walletKeys.js";

/**
 * The burn engine. Every copied trade leaves one token behind on purpose (so a sale can never be refused for selling a hair too much),
 * and with it a token account that holds a rent deposit. This sweep finds those nearly-empty token accounts - five tokens or fewer - burns the
 * crumbs and closes the account, which returns the deposit to the wallet.
 *
 *  - a NORMAL transaction, not Jito: the network's base fee plus a tiny priority fee (a few thousandths of a dollar in all, far below a cent);
 *  - up to ten accounts per transaction (fewer if they don't fit), as many transactions as it takes;
 *  - only live wallets that are connected to a simulation wallet and trading for real. Wallets used any other way are never touched, and
 *    neither is a token the wallet still has an open position (or a buy in progress) in.
 */

export const EMPTY_MAX_TOKENS = 5; // a token account holding this many tokens or fewer counts as empty
export const SWEEP_EVERY_MS = 30 * 60_000;
const ACCOUNTS_PER_TRANSACTION = 10;
const PRIORITY_FEE_LAMPORTS = 5000; // on top of the 5,000-lamport base fee: about $0.002 at today's SOL price
const MIN_SOL_LAMPORTS = 3_000_000; // below this the wallet is left alone (not enough for the fees of even a few accounts)
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const sweeping = new Set(); // wallet ids being swept right now

/** The token accounts of a wallet that count as empty, leaving out any token the wallet is (about to be) holding for a trade. */
export async function findEmptyTokenAccounts(live) {
  const found = [];
  for (const programId of TOKEN_PROGRAMS) {
    const result = await rpc("getTokenAccountsByOwner", [live.address, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    for (const entry of result.value) {
      const info = entry.account.data.parsed.info;
      const amount = Number(info.tokenAmount.uiAmountString);
      if (info.state === "frozen") continue;
      if (info.mint === WSOL_MINT && amount > 0) continue; // wrapped SOL with a balance is money, not crumbs
      if (!(amount <= EMPTY_MAX_TOKENS)) continue;
      if (info.closeAuthority && info.closeAuthority !== live.address) continue;
      found.push({ account: entry.pubkey, mint: info.mint, amount });
    }
  }
  if (found.length === 0) return found;

  const busy = new Set([
    ...(await LiveLot.distinct("mint", { liveWalletId: live._id, status: "open" })),
    ...(await LiveLot.distinct("sellCarry.mint", { liveWalletId: live._id, status: "open" })).filter(Boolean), // paid out by a sale that isn't finished
    ...(await LiveExecution.distinct("mint", { liveWalletId: live._id, status: { $in: ["pending", "processing"] } })),
  ]);
  return found.filter((f) => !busy.has(f.mint));
}

/**
 * Sweeps one wallet. Safe to call at any time and from anywhere: a wallet already being swept is skipped.
 * @returns {Promise<{ closed: number, reclaimedLamports: number, failed: number, skipped: number } | null>} null if it was skipped
 */
export async function sweepWallet(liveId) {
  const key = String(liveId);
  if (sweeping.has(key)) return null;
  sweeping.add(key);
  let secret = null;
  try {
    const live = await LiveWallet.findById(liveId).select("+encryptedSecret");
    if (!live) return null;
    const balance = (await rpc("getBalance", [live.address, { commitment: "confirmed" }])).value;
    const empty = balance >= MIN_SOL_LAMPORTS ? await findEmptyTokenAccounts(live) : [];
    await LiveWallet.updateOne({ _id: live._id }, { $set: { lastBurnSweepAt: new Date() } });
    if (empty.length === 0) return { closed: 0, reclaimedLamports: 0, failed: 0, skipped: 0 };

    secret = base58Decode(decryptWalletSecret(live.address, live.encryptedSecret));
    if (secret.length !== 64 || base58Encode(secret.subarray(32)) !== live.address) throw new Error("The stored key doesn't match the live wallet.");
    const result = await burnAndCloseMany({
      secretKey: secret,
      tokenAccounts: empty.map((e) => e.account),
      perTransaction: ACCOUNTS_PER_TRANSACTION,
      priorityFeeLamports: PRIORITY_FEE_LAMPORTS,
    });
    invalidateChainSnapshot(live.address);

    const closed = result.transactions.reduce((total, t) => total + t.accounts.length, 0);
    const reclaimedLamports = result.transactions.reduce((total, t) => total + t.reclaimedLamports, 0);
    const failed = result.failed.reduce((total, f) => total + f.accounts.length, 0);
    logEvent("tracker", `[live-wallet] Burn engine for "${live.name}": closed ${closed} empty token account(s), reclaimed ${(reclaimedLamports / 1e9).toFixed(5)} SOL${failed ? `, ${failed} failed` : ""}`, {
      level: failed ? "warn" : "info",
      meta: { walletId: String(live._id), closed, reclaimedLamports, failed, signatures: result.transactions.map((t) => t.signature), reasons: result.failed.map((f) => f.reason).slice(0, 3) },
    });
    return { closed, reclaimedLamports, failed, skipped: result.skipped.length };
  } finally {
    secret?.fill(0);
    sweeping.delete(key);
  }
}

/** One pass over every live wallet that is connected and trading for real. */
export async function sweepAllWallets() {
  const wallets = await LiveWallet.find({ connectedWalletId: { $ne: null }, tradingMode: "live" }, { _id: 1 }).lean();
  let closed = 0;
  for (const wallet of wallets) {
    try {
      closed += (await sweepWallet(wallet._id))?.closed ?? 0;
    } catch (err) {
      logEvent("tracker", `[live-wallet] Burn engine failed for wallet ${wallet._id}: ${err instanceof Error ? err.message : err}`, { level: "error", meta: { walletId: String(wallet._id) } });
    }
  }
  return closed;
}
