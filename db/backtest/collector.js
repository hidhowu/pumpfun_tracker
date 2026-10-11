import { parseTransaction } from "../../src/parseTransaction.js";
import { extractPumpTrades } from "../../src/extractPumpTrades.js";
import { BacktestTx } from "../models/BacktestTx.js";
import { BacktestScan } from "../models/BacktestScan.js";

const SIGNATURE_PAGE = 1000; // getSignaturesForAddress maximum
const EXISTS_CHUNK = 500;
const WRITE_BATCH = 25;

export class StopRequested extends Error {}

/** Resolves the work pool: runs `worker` over `items` with at most `concurrency` in flight; stops scheduling once `shouldStop()`. */
async function mapPool(items, concurrency, worker, shouldStop) {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      if (shouldStop()) throw new StopRequested();
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Lists an address's signatures (newest first) from the RPC, paging with
 * `before`, until `minTime` is passed or the history/`until` boundary ends.
 * Every row is kept (including failed transactions) so boundary signatures for
 * the coverage record can be taken from the full list; callers filter on `err`.
 */
async function listSignatures(rpcPool, address, { before, until, minTime, maxTime, shouldStop, onPage }) {
  const rows = [];
  let cursor = before;
  for (;;) {
    if (shouldStop()) throw new StopRequested();
    const params = { limit: SIGNATURE_PAGE, commitment: "confirmed" };
    if (cursor) params.before = cursor;
    if (until) params.until = until;
    const page = await rpcPool.call("getSignaturesForAddress", [address, params]);
    if (!Array.isArray(page) || page.length === 0) break;

    let passedMin = false;
    for (const row of page) {
      if (row.blockTime == null) continue; // no timestamp - can't place it in a window
      if (minTime != null && row.blockTime < minTime) {
        passedMin = true;
        break;
      }
      if (maxTime != null && row.blockTime > maxTime) continue;
      rows.push({ signature: row.signature, slot: row.slot, blockTime: row.blockTime, failed: !!row.err });
    }
    onPage?.(rows.length);
    if (passedMin || page.length < SIGNATURE_PAGE) break;
    cursor = page[page.length - 1].signature;
  }
  return rows;
}

async function filterUncached(address, rows) {
  const uncached = [];
  for (let i = 0; i < rows.length; i += EXISTS_CHUNK) {
    const chunk = rows.slice(i, i + EXISTS_CHUNK);
    const have = await BacktestTx.find({ address, signature: { $in: chunk.map((r) => r.signature) } }, { signature: 1 }).lean();
    const haveSet = new Set(have.map((h) => h.signature));
    for (const row of chunk) if (!haveSet.has(row.signature)) uncached.push(row);
  }
  return uncached;
}

/**
 * Collect stage for one address: make sure every transaction in
 * [windowStartSec, windowEndSec] has been fetched, parsed and cached in
 * BacktestTx. Anything already cached (from this or any earlier run) is
 * skipped, and the address's coverage record (BacktestScan) means only the
 * missing ends of the window are even listed. Resumable at any point: cached
 * rows persist, so a restart just skips what's already done.
 *
 * @param {object} p
 * @param {import("./rpcPool.js").BacktestRpcPool} p.rpcPool
 * @param {(patch: object) => void} p.progress  merges counters into the run-trader document (throttled by the caller)
 */
export async function collectAddress({ address, windowStartSec, windowEndSec, rpcPool, txConcurrency, shouldStop, progress }) {
  const scan = await BacktestScan.findOne({ address }).lean();
  const need = [];
  if (!scan) {
    need.push({ minTime: windowStartSec });
  } else {
    if (windowEndSec > scan.coverTo) need.push({ until: scan.newestSignature, minTime: null });
    if (windowStartSec < scan.coverFrom) need.push({ before: scan.oldestSignature, minTime: windowStartSec });
  }

  progress({ "collect.listing": true });
  let listed = [];
  for (const plan of need) {
    const rows = await listSignatures(rpcPool, address, {
      before: plan.before,
      until: plan.until,
      minTime: plan.minTime,
      maxTime: windowEndSec,
      shouldStop,
      onPage: (count) => progress({ "collect.signaturesFound": listed.length + count }),
    });
    listed = listed.concat(rows);
  }

  const successful = listed.filter((r) => !r.failed);
  const toProcess = await filterUncached(address, successful);
  progress({
    "collect.listing": false,
    "collect.signaturesFound": successful.length,
    "collect.signaturesToProcess": toProcess.length,
    "collect.signaturesProcessed": 0,
    "collect.signaturesFailed": 0,
  });

  // ---- fetch + parse + cache
  let processed = 0;
  let failed = 0;
  let buffer = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const ops = buffer.map((row) => ({ updateOne: { filter: { address: row.address, signature: row.signature }, update: { $set: row }, upsert: true } }));
    buffer = [];
    await BacktestTx.bulkWrite(ops, { ordered: false });
  };

  let retryRows = [];
  const processOne = async (row, isRetry = false) => {
    try {
      const parsed = await parseTransaction(row.signature, rpcPool, { maxAttempts: 2, baseDelayMs: 300 });
      const trades = extractPumpTrades(parsed, { forAddress: address }).map((t) => ({
        type: t.type,
        program: t.program,
        mint: t.mint,
        tokenAmount: t.tokenAmount,
        solAmount: t.solAmount,
        solAmountSource: t.solAmountSource,
        isNativeSolQuote: t.isNativeSolQuote,
      }));
      buffer.push({
        address,
        signature: row.signature,
        blockTime: parsed.summary.blockTime ?? row.blockTime,
        slot: parsed.summary.slot ?? row.slot ?? null,
        trades,
        unavailable: false,
      });
    } catch (err) {
      if (err instanceof StopRequested) throw err;
      if (/not found \(null result\)/i.test(err.message || "")) {
        // The RPC genuinely doesn't have it (pruned) - remember that, don't retry forever.
        buffer.push({ address, signature: row.signature, blockTime: row.blockTime, slot: row.slot ?? null, trades: [], unavailable: true });
      } else if (!isRetry) {
        retryRows.push(row); // one more pass after the main one, once rate-limit cooldowns have passed
        return;
      } else {
        failed += 1;
      }
    }
    processed += 1;
    if (buffer.length >= WRITE_BATCH) await flush();
    if (processed % 10 === 0 || processed === toProcess.length) {
      progress({ "collect.signaturesProcessed": processed, "collect.signaturesFailed": failed });
    }
  };

  try {
    await mapPool(toProcess, txConcurrency, (row) => processOne(row), shouldStop);
    const toRetry = retryRows;
    retryRows = [];
    if (toRetry.length > 0) await mapPool(toRetry, txConcurrency, (row) => processOne(row, true), shouldStop);
  } finally {
    await flush().catch(() => {});
    progress({ "collect.signaturesProcessed": processed, "collect.signaturesFailed": failed });
  }

  // ---- record coverage, only when nothing failed (a failed signature must be retried next time, so the span isn't "complete")
  if (failed === 0) {
    const all = listed.slice().sort((a, b) => a.blockTime - b.blockTime);
    const newest = all.at(-1);
    const oldest = all[0];
    if (!scan) {
      if (all.length > 0) {
        await BacktestScan.updateOne(
          { address },
          { $set: { coverFrom: windowStartSec, coverTo: windowEndSec, oldestSignature: oldest.signature, newestSignature: newest.signature, updatedAt: new Date() } },
          { upsert: true }
        );
      }
    } else {
      const set = { updatedAt: new Date() };
      if (windowEndSec > scan.coverTo) {
        set.coverTo = windowEndSec;
        if (newest && newest.blockTime >= scan.coverTo) set.newestSignature = newest.signature;
      }
      if (windowStartSec < scan.coverFrom) {
        set.coverFrom = windowStartSec;
        if (oldest && oldest.blockTime <= scan.coverFrom) set.oldestSignature = oldest.signature;
      }
      await BacktestScan.updateOne({ address }, { $set: set });
    }
  }

  return { failed };
}
