import { LiveWallet } from "../models/LiveWallet.js";
import { stuckSellCounts } from "./trading/service.js";
import { LiveWalletTx } from "../models/LiveWalletTx.js";
import { getSolUsd } from "../onchainPrice.js";
import { isTwoFactorEnabled, verifyTwoFactorStepUp } from "../authService.js";
import { logEvent } from "../systemLog.js";
import { getChainSnapshot, invalidateChainSnapshot } from "./chain.js";
import { BurnError, burnAndCloseTokenAccount } from "./burnTokenAccount.js";
import { parseSolToLamports, transferSol } from "./transferSol.js";
import { getTokenMeta } from "./tokenMeta.js";
import { buildLedger, emptyStats } from "./pnl.js";
import { syncLiveWallet } from "./txSync.js";
import { base58Decode, base58Encode, decryptWalletSecret, encryptForClient, encryptWalletSecret, generateSolanaKeypair, isWalletEncryptionConfigured } from "./walletKeys.js";

const MAX_WALLETS = 50;

/** Everything about a wallet that is safe to send to the browser - never the stored secret. */
function walletView(w) {
  return {
    _id: String(w._id),
    name: w.name,
    address: w.address,
    createdAt: w.createdAt,
    lastSyncedAt: w.lastSyncedAt,
    lastSyncError: w.lastSyncError,
  };
}

export class LiveWalletError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const TWO_FACTOR_REQUIRED = "Two-factor sign-in must be turned on (Account page) before you can create a wallet or view a private key.";

/**
 * Generates a wallet, stores its private key encrypted, and returns the key encrypted for the browser that asked
 * (see db/live/walletKeys.js). Only an account with two-factor turned on can do this. The key can be viewed again only
 * through revealLiveWalletKey, which asks for a fresh authenticator code.
 */
export async function createLiveWallet({ userId, name, clientPublicKey }) {
  if (!(await isTwoFactorEnabled(userId))) throw new LiveWalletError(TWO_FACTOR_REQUIRED, 403);
  if (!isWalletEncryptionConfigured()) {
    throw new LiveWalletError("WALLET_ENCRYPTION_KEY is not set on the server (at least 32 random characters) - see .env.example", 503);
  }
  if ((await LiveWallet.countDocuments()) >= MAX_WALLETS) throw new LiveWalletError(`At most ${MAX_WALLETS} live wallets`, 409);

  const { address, secretKey } = generateSolanaKeypair();
  // Encrypt for the browser first: a bad public key must fail before anything is saved.
  let keyPayload;
  try {
    keyPayload = encryptForClient(clientPublicKey, address, secretKey);
  } catch {
    throw new LiveWalletError("Invalid client key");
  }
  const wallet = await LiveWallet.create({ name, address, encryptedSecret: encryptWalletSecret(address, secretKey) });
  return { wallet: walletView(wallet), keyPayload };
}

/**
 * Shows a wallet's private key again: needs two-factor on AND a fresh authenticator code, and the key is returned only
 * encrypted for the asking browser. Every view is written to the Logs page (never the key itself).
 */
export async function revealLiveWalletKey(id, { userId, username, code, clientPublicKey, ip }) {
  if (!(await isTwoFactorEnabled(userId))) throw new LiveWalletError(TWO_FACTOR_REQUIRED, 403);
  const wallet = await LiveWallet.findById(id).select("+encryptedSecret").lean();
  if (!wallet) throw new LiveWalletError("Wallet not found", 404);

  const check = await verifyTwoFactorStepUp(userId, code, { ip });
  if (!check.ok) {
    logEvent("tracker", `[live-wallet] Failed private-key view attempt for "${wallet.name}" by ${username}`, { level: "warn", meta: { walletId: String(wallet._id), reason: check.error } });
    throw new LiveWalletError(check.error, check.status);
  }

  let keyPayload;
  try {
    keyPayload = encryptForClient(clientPublicKey, wallet.address, decryptWalletSecret(wallet.address, wallet.encryptedSecret));
  } catch {
    throw new LiveWalletError("Couldn't read this wallet's key", 500);
  }
  logEvent("tracker", `[live-wallet] Private key of "${wallet.name}" viewed by ${username}`, { level: "warn", meta: { walletId: String(wallet._id) } });
  return keyPayload;
}

export async function renameLiveWallet(id, name) {
  const wallet = await LiveWallet.findByIdAndUpdate(id, { $set: { name } }, { new: true });
  return wallet ? walletView(wallet) : null;
}

/**
 * All wallets with their current SOL balance, total value and realized profit/loss (from the stored history - the list
 * never waits on a sync). A wallet whose balance can't be read right now still lists.
 */
export async function listLiveWallets() {
  const wallets = await LiveWallet.find().sort({ createdAt: 1 }).lean();
  const stuck = await stuckSellCounts();
  return Promise.all(
    wallets.map(async (w) => {
      const view = { ...walletView(w), stuckSells: stuck.get(String(w._id)) ?? 0 };
      const { totals } = await loadLedger(w._id);
      const pnl = { realizedPnlUsd: totals.realizedPnlUsd, wins: totals.wins, losses: totals.losses, sells: totals.sells };
      try {
        const chain = await getChainSnapshot(w.address);
        return { ...view, ...pnl, solBalance: chain.solBalance, totalValueUsd: chain.totalValueUsd, tokenCount: chain.tokens.length, error: null };
      } catch (err) {
        return { ...view, ...pnl, solBalance: null, totalValueUsd: null, tokenCount: null, error: err instanceof Error ? err.message : "Balance unavailable" };
      }
    })
  );
}

async function loadLedger(walletId) {
  const rows = await LiveWalletTx.find({ walletId }).sort({ slot: 1, signature: 1 }).lean();
  return buildLedger(rows, await getSolUsd());
}

// A first sync of a wallet with a long history can take minutes. Requests wait this long for it, then answer with what is
// stored so far; the sync carries on in the background (syncLiveWallet is single-flight) and the next poll picks it up.
const SYNC_WAIT_MS = 4_000;

function syncQuietly(wallet) {
  const sync = syncLiveWallet(wallet).then(
    () => null,
    (err) => (err instanceof Error ? err.message : "Sync failed")
  );
  return Promise.race([sync, new Promise((resolve) => setTimeout(() => resolve(null), SYNC_WAIT_MS))]);
}

/** The wallet dashboard: balances and holdings from the chain, profit/loss from its stored history. */
export async function getLiveWalletDetail(id) {
  const found = await LiveWallet.findById(id).lean();
  if (!found) return null;
  // The chain read and the history sync don't depend on each other - run them together.
  const [syncError, chain] = await Promise.all([
    syncQuietly(found),
    getChainSnapshot(found.address).catch((err) => ({ error: err instanceof Error ? err.message : "Couldn't read the chain" })),
  ]);
  const wallet = (await LiveWallet.findById(id).lean()) ?? found;
  const ledger = await loadLedger(wallet._id);

  let holdings = [];
  let unrealizedPnlUsd = 0;
  if (!chain.error) {
    holdings = chain.tokens.map((t) => {
      const stats = ledger.perMint.get(t.mint);
      const avgCostSol = stats?.avgCostSol ?? null;
      const costBasisUsd = avgCostSol !== null && chain.solUsd ? avgCostSol * t.balance * chain.solUsd : null;
      const unrealized = costBasisUsd !== null && t.valueUsd !== null ? t.valueUsd - costBasisUsd : null;
      if (unrealized !== null) unrealizedPnlUsd += unrealized;
      return {
        ...t,
        costBasisUsd,
        unrealizedPnlUsd: unrealized,
        unrealizedPnlPct: unrealized !== null && costBasisUsd > 0 ? (unrealized / costBasisUsd) * 100 : null,
        realizedPnlUsd: stats?.realizedPnlUsd ?? 0,
      };
    });
  }

  return {
    wallet: walletView(wallet),
    chain: chain.error ? null : { ...chain, tokens: holdings },
    chainError: chain.error ?? null,
    syncError: syncError ?? wallet.lastSyncError ?? null,
    pnl: { ...ledger.totals, unrealizedPnlUsd },
  };
}

const SOL_KINDS = new Set(["sol_in", "sol_out", "buy", "sell", "other", "failed"]);

/**
 * One page of the wallet's transactions, newest first, each sell carrying its realised profit or loss. Optionally one token / kind.
 * @param {string} id
 * @param {{ mint?: string | null, kind?: string | null, page?: number, limit?: number, sync?: boolean }} [options]
 */
export async function getLiveWalletTransactions(id, { mint = null, kind = null, page = 1, limit = 25, sync = true } = {}) {
  const found = await LiveWallet.findById(id).lean();
  if (!found) return null;
  const syncError = sync ? await syncQuietly(found) : null;

  const ledger = await loadLedger(found._id);
  let rows = ledger.rows;
  // "SOL" is not a mint: it asks for every movement of SOL itself - swaps against a token, plain transfers, and network fees.
  if (mint === "SOL") rows = rows.filter((r) => SOL_KINDS.has(r.kind));
  else if (mint) rows = rows.filter((r) => r.mint === mint);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  rows = rows.reverse(); // newest first

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const slice = rows.slice((page - 1) * limit, page * limit);
  const meta = await getTokenMeta(slice.map((r) => r.mint).filter(Boolean));

  const transactions = slice.map((r) => {
    const m = r.mint ? meta.get(r.mint) : null;
    const trade = r.kind === "buy" || r.kind === "sell";
    return {
      signature: r.signature,
      kind: r.kind,
      mint: r.mint,
      symbol: m?.symbol ?? null,
      name: m?.name ?? null,
      icon: m?.icon ?? null,
      blockTime: r.blockTime,
      tokenDelta: r.tokenDelta,
      solDelta: r.solDelta,
      feeSol: r.feeSol,
      priceUsd: trade && r.tokenDelta !== 0 && r.solUsd ? (Math.abs(r.solDelta) / Math.abs(r.tokenDelta)) * r.solUsd : null,
      valueUsd: r.valueSol !== null && r.solUsd ? r.valueSol * r.solUsd : r.solUsd ? Math.abs(r.solDelta) * r.solUsd : null,
      costBasisUsd: r.costBasisSol !== null && r.solUsd ? r.costBasisSol * r.solUsd : null,
      realizedPnlSol: r.realizedPnlSol,
      realizedPnlPct: r.realizedPnlPct,
      realizedPnlUsd: r.realizedPnlUsd,
    };
  });

  const summary = mint && mint !== "SOL" ? ledger.perMint.get(mint) ?? emptyStats() : ledger.totals;
  return { transactions, page, totalPages, total, summary, syncError: syncError ?? found.lastSyncError ?? null };
}

const burning = new Set(); // "walletId:tokenAccount" currently being burned - a double click must never send two transactions

/**
 * Burns a token account's tokens and closes the account (rent returns to the wallet), signed with the wallet's own key.
 * The key is decrypted only for the length of this call and wiped afterwards. Needs two-factor to be on for the account,
 * like every other action that touches a wallet's key. The signing itself is db/live/burnTokenAccount.js, which any other
 * part of the app can call directly with a key and a token account.
 */
export async function burnLiveWalletTokenAccount(id, { userId, username, account }) {
  if (!(await isTwoFactorEnabled(userId))) throw new LiveWalletError(TWO_FACTOR_REQUIRED, 403);
  if (!isWalletEncryptionConfigured()) throw new LiveWalletError("Wallet encryption isn't configured on this server (WALLET_ENCRYPTION_KEY).", 503);
  const wallet = await LiveWallet.findById(id).select("+encryptedSecret");
  if (!wallet) throw new LiveWalletError("Wallet not found", 404);

  const lock = `${wallet._id}:${account}`;
  if (burning.has(lock)) throw new LiveWalletError("This token account is already being burned.", 409);
  burning.add(lock);
  let secret = null;
  try {
    secret = base58Decode(decryptWalletSecret(wallet.address, wallet.encryptedSecret));
    if (secret.length !== 64 || base58Encode(secret.subarray(32)) !== wallet.address) throw new LiveWalletError("The stored key doesn't match this wallet.", 500);
    const result = await burnAndCloseTokenAccount({ secretKey: secret, tokenAccount: account });
    invalidateChainSnapshot(wallet.address);
    logEvent("tracker", `[live-wallet] "${wallet.name}": burned ${result.burned} of ${result.mint} and closed token account ${account} (${result.status}) by ${username}`, {
      level: "warn",
      meta: { walletId: String(wallet._id), account, mint: result.mint, signature: result.signature },
    });
    return result;
  } catch (err) {
    if (err instanceof BurnError) {
      logEvent("tracker", `[live-wallet] Burn of token account ${account} in "${wallet.name}" by ${username} failed: ${err.message}`, { level: "warn", meta: { walletId: String(wallet._id), account } });
      throw new LiveWalletError(err.message, err.status);
    }
    throw err;
  } finally {
    secret?.fill(0);
    burning.delete(lock);
  }
}

const transferring = new Set(); // wallet ids with a transfer in progress - a double click must never send two

/**
 * Sends SOL from one live wallet to ANOTHER LIVE WALLET ON THIS PLATFORM (never to an outside address: the destination is looked up by its id).
 * Needs two-factor on and a fresh authenticator code, like viewing the key. The key is decrypted only for the length of the call and wiped after.
 * @param {{ userId: string, username: string, toId: string, amountSol?: string|number, all?: boolean, code: string, ip?: string }} actor
 */
export async function transferLiveWalletSol(id, { userId, username, toId, amountSol, all = false, code, ip }) {
  if (!(await isTwoFactorEnabled(userId))) throw new LiveWalletError(TWO_FACTOR_REQUIRED, 403);
  if (!isWalletEncryptionConfigured()) throw new LiveWalletError("Wallet encryption isn't configured on this server (WALLET_ENCRYPTION_KEY).", 503);
  if (String(id) === String(toId)) throw new LiveWalletError("Choose a different wallet to send to.");
  const lamports = all ? null : parseSolToLamports(amountSol);
  if (!all && lamports == null) throw new LiveWalletError("Enter an amount in SOL (up to 9 decimals), or use Max.");
  const wallet = await LiveWallet.findById(id).select("+encryptedSecret");
  if (!wallet) throw new LiveWalletError("Wallet not found", 404);
  const target = await LiveWallet.findById(toId).lean();
  if (!target) throw new LiveWalletError("The receiving wallet wasn't found on this platform.", 404);
  if (transferring.has(String(wallet._id))) throw new LiveWalletError("A transfer from this wallet is already in progress.", 409);

  const check = await verifyTwoFactorStepUp(userId, String(code ?? "").trim().slice(0, 12), { ip });
  if (!check.ok) {
    logEvent("tracker", `[live-wallet] Failed transfer attempt from "${wallet.name}" by ${username}`, { level: "warn", meta: { walletId: String(wallet._id), reason: check.error } });
    throw new LiveWalletError(check.error, check.status);
  }

  transferring.add(String(wallet._id));
  let secret = null;
  try {
    secret = base58Decode(decryptWalletSecret(wallet.address, wallet.encryptedSecret));
    if (secret.length !== 64 || base58Encode(secret.subarray(32)) !== wallet.address) throw new LiveWalletError("The stored key doesn't match this wallet.", 500);
    const result = await transferSol({ secretKey: secret, to: target.address, lamports, all });
    invalidateChainSnapshot(wallet.address);
    invalidateChainSnapshot(target.address);
    logEvent("tracker", `[live-wallet] "${wallet.name}" sent ${result.lamports / 1e9} SOL to "${target.name}" (${result.status}) by ${username}`, {
      level: "warn",
      meta: { walletId: String(wallet._id), toWalletId: String(target._id), signature: result.signature, lamports: result.lamports },
    });
    return { ...result, toName: target.name };
  } catch (err) {
    if (err instanceof BurnError) {
      logEvent("tracker", `[live-wallet] Transfer from "${wallet.name}" to "${target.name}" by ${username} failed: ${err.message}`, { level: "warn", meta: { walletId: String(wallet._id), toWalletId: String(target._id) } });
      throw new LiveWalletError(err.message, err.status);
    }
    throw err;
  } finally {
    secret?.fill(0);
    transferring.delete(String(wallet._id));
  }
}
