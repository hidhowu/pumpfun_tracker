import { BacktestTx } from "../models/BacktestTx.js";
import { BacktestScan } from "../models/BacktestScan.js";
import { StopRequested, SignatureLimitExceeded } from "./collector.js";

// Quote assets, not tokens: wrapped SOL and the big stablecoins. A swap of one of these isn't a copy-tradable buy/sell.
const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);
const USER_TRADES_PAGE = 100; // page size requested from the API (see PumpTradesClient)
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** Cursor that returns trades strictly older than the END of second `sec` (so a trade in second `sec` itself is included). */
const cursorAfter = (sec) => `${(sec + 1) * 1_000_000}:${ZERO_UUID}`;

/**
 * pump.fun's slotIndexId is the slot (12 digits, zero padded) followed by the
 * position inside that slot - which is exactly what's needed to order trades.
 */
function splitSlotIndexId(id) {
  if (typeof id !== "string" || id.length <= 12 || !/^\d+$/.test(id)) return { slot: null, ix: null };
  return { slot: Number(id.slice(0, 12)), ix: id.slice(12) };
}

/** Groups swap rows into one BacktestTx document per transaction - the shape the simulation already reads. */
function toTxDocs(address, rows) {
  const byTx = new Map();
  for (const t of rows) {
    let doc = byTx.get(t.tx);
    if (!doc) {
      const { slot, ix } = splitSlotIndexId(t.slotIndexId);
      byTx.set(t.tx, (doc = { address, signature: t.tx, blockTime: t.ts, slot, ix, trades: [], unavailable: false }));
    }
    doc.trades.push({
      type: t.isBuy ? "buy" : "sell",
      program: "pump",
      mint: t.mint,
      tokenAmount: t.tokenAmount,
      solAmount: t.amountSol,
      solAmountSource: "user-trades-api",
      isNativeSolQuote: true,
    });
  }
  return [...byTx.values()];
}

/**
 * Collect stage for one address, from pump.fun's user-trades API instead of the
 * chain: the wallet's swaps for the window come back as ready-made rows (token,
 * side, amounts, time), so there is no signature listing and no per-transaction
 * RPC fetch - what used to be thousands of requests is a few dozen pages.
 *
 * Writes the same BacktestTx cache the simulation reads, and records which span
 * is covered (BacktestScan.apiCover*) so a later backtest only reads the
 * missing ends. Resumable: every page is saved as it arrives.
 *
 * @param {object} p
 * @param {import("./pumpTradesClient.js").PumpTradesClient} p.client  a client paced at the user-trades rate
 * @param {(patch: object) => void} p.progress
 * @param {number} [p.maxSignatures]  skip the address (SignatureLimitExceeded) when its window holds more trades than this
 */
export async function collectAddressViaApi({ address, userId, windowStartSec, windowEndSec, client, shouldStop, progress, maxSignatures = 0 }) {
  const scan = await BacktestScan.findOne({ address }).lean();
  const haveApi = scan && scan.apiCoverFrom != null && scan.apiCoverTo != null;

  // Only the part of the window not already collected.
  const spans = [];
  if (!haveApi) {
    spans.push({ from: windowStartSec, to: windowEndSec });
  } else {
    if (windowEndSec > scan.apiCoverTo) spans.push({ from: scan.apiCoverTo, to: windowEndSec });
    if (windowStartSec < scan.apiCoverFrom) spans.push({ from: windowStartSec, to: scan.apiCoverFrom });
  }

  progress({ "collect.source": "api", "collect.listing": true });
  // Trades already cached from an earlier run count toward the limit too: it is about how busy the address is.
  let found = maxSignatures > 0 && haveApi ? await BacktestTx.countDocuments({ address, blockTime: { $gte: windowStartSec, $lte: windowEndSec } }) : 0;

  // Rows already counted this run: slices overlap by the boundary second, and a retried page repeats rows.
  const counted = new Set();
  let failed = false;

  /** Saves one page's rows, counts them, enforces the limit. */
  const store = async (page, span) => {
    const rows = page.trades.filter((t) => t.kind === "trade" && t.tx && t.mint && !QUOTE_MINTS.has(t.mint) && t.ts >= span.from && t.ts <= span.to);
    if (rows.length === 0) return;
    const docs = toTxDocs(address, rows);
    await BacktestTx.bulkWrite(
      docs.map((d) => ({ updateOne: { filter: { address: d.address, signature: d.signature }, update: { $set: d }, upsert: true } })),
      { ordered: false }
    );
    for (const t of rows) {
      const key = t.slotIndexId || `${t.tx}:${t.mint}:${t.isBuy}`;
      if (!counted.has(key)) {
        counted.add(key);
        found += 1;
      }
    }
    progress({ "collect.signaturesFound": found });
    if (maxSignatures > 0 && found > maxSignatures) throw new SignatureLimitExceeded(found, maxSignatures, "trades");
  };

  /** Pages one stretch of time backwards, newest first, until it is read past the start of `span`. */
  const readSlice = async (span, startCursor) => {
    let cursor = startCursor;
    for (;;) {
      if (failed) return;
      if (shouldStop()) throw new StopRequested();
      const page = await client.fetchUserTrades(userId, cursor);
      await store(page, span);
      const oldest = page.trades.length > 0 ? Math.min(...page.trades.map((t) => t.ts)) : null;
      if (!page.nextCursor || (page.trades.length === 0 && page.nextCursor === cursor)) return; // end of the wallet's history
      if (oldest != null && oldest < span.from) return; // read past the start of the span
      cursor = page.nextCursor;
    }
  };

  for (const span of spans) {
    // Pages chain through a cursor, so one stretch can only be read serially - but a cursor can also be built from a
    // timestamp. The newest page shows how busy the wallet is; the older rest of the span is then cut into time slices
    // that are read at the same time, spread over the proxies. Sparse wallets stay at one page.
    await client.refresh();
    if (shouldStop()) throw new StopRequested();
    const first = await client.fetchUserTrades(userId, cursorAfter(span.to));
    await store(first, span);
    const oldest = first.trades.length > 0 ? Math.min(...first.trades.map((t) => t.ts)) : null;
    if (!first.nextCursor || first.trades.length === 0) continue;
    if (oldest != null && oldest < span.from) continue;

    const covered = Math.max(1, span.to - (oldest ?? span.to) + 1);
    const restFrom = span.from;
    const restTo = oldest ?? span.to; // the boundary second is read again on purpose: its rows may continue onto the next page
    const estimatedPages = Math.ceil(((first.trades.length / covered) * Math.max(0, restTo - restFrom + 1)) / USER_TRADES_PAGE);
    const lanes = Math.max(1, client.lanes);
    const sliceCount = Math.max(1, Math.min(lanes * 2, Math.ceil(estimatedPages * 1.5), restTo - restFrom + 1));
    const size = Math.ceil((restTo - restFrom + 1) / sliceCount);
    const slices = [];
    for (let from = restFrom; from <= restTo; from += size) slices.push({ from, to: Math.min(restTo, from + size - 1) });

    // Newest slices first: they are the likeliest to be dense (and to hit the signature limit early).
    slices.reverse();
    let nextSlice = 0;
    const workers = Array.from({ length: Math.min(lanes, slices.length) }, async () => {
      while (nextSlice < slices.length && !failed) {
        const slice = slices[nextSlice++];
        await readSlice({ from: slice.from, to: slice.to }, cursorAfter(slice.to));
      }
    });
    try {
      await Promise.all(workers.map((w) => w.catch((err) => { failed = true; throw err; })));
    } catch (err) {
      failed = true;
      await Promise.allSettled(workers);
      throw err;
    }
  }

  // The whole window is now in the cache.
  const from = haveApi ? Math.min(scan.apiCoverFrom, windowStartSec) : windowStartSec;
  const to = haveApi ? Math.max(scan.apiCoverTo, windowEndSec) : windowEndSec;
  await BacktestScan.updateOne({ address }, { $set: { apiCoverFrom: from, apiCoverTo: to, updatedAt: new Date() } }, { upsert: true });

  progress({ "collect.listing": false, "collect.signaturesFound": found, "collect.signaturesToProcess": 0, "collect.signaturesProcessed": 0, "collect.signaturesFailed": 0 });
  return { failed: 0 };
}
