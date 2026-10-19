import { rpc, getSolUsd } from "../onchainPrice.js";
import { LiveWallet } from "../models/LiveWallet.js";
import { LiveWalletTx } from "../models/LiveWalletTx.js";
import { parseWalletTransaction } from "./txParse.js";

/**
 * Copies a live wallet's on-chain transaction history into LiveWalletTx. Incremental: `lastSignature` is the newest
 * transaction already stored, so each sync only asks the RPC for what is newer. Every write is an upsert keyed on
 * (wallet, signature, token), so a sync that dies half-way, or two that overlap, can never double-count anything.
 * The first sync of a wallet takes at most its newest MAX_PER_SYNC transactions.
 */

const MAX_PER_SYNC = 1000;
const FETCH_CONCURRENCY = 4;
const MIN_INTERVAL_MS = 15_000;

const running = new Map(); // wallet id -> Promise, so overlapping requests share one sync

async function signaturesSince(address, until) {
  const found = [];
  let before;
  while (found.length < MAX_PER_SYNC) {
    const limit = Math.min(1000, MAX_PER_SYNC - found.length);
    const page = await rpc("getSignaturesForAddress", [address, { limit, before, until: until || undefined, commitment: "confirmed" }]);
    found.push(...page);
    if (page.length < limit) break;
    before = page[page.length - 1].signature;
  }
  return found; // newest first
}

async function fetchAll(signatures) {
  const results = new Array(signatures.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, signatures.length) }, async () => {
      while (next < signatures.length) {
        const i = next++;
        // 255 = accept any transaction version. A transaction that can't be fetched right now (rate limit, not yet
        // available) comes back null; the cursor then stays put and the next sync retries it.
        results[i] = await rpc("getTransaction", [signatures[i].signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 255, commitment: "confirmed" }]).catch(() => null);
      }
    })
  );
  return results;
}

async function run(wallet) {
  let incomplete = false;
  try {
    const sigs = await signaturesSince(wallet.address, wallet.lastSignature);
    if (sigs.length) {
      const [txs, solUsd] = await Promise.all([fetchAll(sigs), getSolUsd()]);
      const ops = [];
      txs.forEach((tx, i) => {
        if (!tx) {
          incomplete = true;
          return;
        }
        for (const row of parseWalletTransaction(tx, wallet.address)) {
          const key = { walletId: wallet._id, signature: sigs[i].signature, mint: row.mint };
          ops.push({ updateOne: { filter: key, update: { $setOnInsert: { ...key, ...row, solUsd: solUsd ?? null } }, upsert: true } });
        }
      });
      if (ops.length) await LiveWalletTx.bulkWrite(ops, { ordered: false });
      if (!incomplete) await LiveWallet.updateOne({ _id: wallet._id }, { $set: { lastSignature: sigs[0].signature } });
    }
    await LiveWallet.updateOne({ _id: wallet._id }, { $set: { lastSyncedAt: new Date(), lastSyncError: incomplete ? "Some transactions could not be fetched yet - retrying on the next refresh" : null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await LiveWallet.updateOne({ _id: wallet._id }, { $set: { lastSyncError: message.slice(0, 300) } });
    throw err;
  }
}

/** Brings the stored history up to date unless it was synced in the last few seconds. Concurrent calls share one run. */
export function syncLiveWallet(wallet, { force = false } = {}) {
  const id = String(wallet._id);
  if (running.has(id)) return running.get(id);
  if (!force && wallet.lastSyncedAt && Date.now() - new Date(wallet.lastSyncedAt).getTime() < MIN_INTERVAL_MS) return Promise.resolve();
  const promise = run(wallet).finally(() => running.delete(id));
  running.set(id, promise);
  return promise;
}
