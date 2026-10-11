/**
 * Turns an address's cached on-chain trades into per-token "signals": the
 * trader's buys and sells of one mint, in the order they happened. Pure
 * functions, no I/O - the same rules the live engine applies
 * (db/simulation/engine.js), just evaluated over history.
 */

// Same constant as db/simulation/engine.js: a sell that brings the cumulative sold fraction to 95%+ is a full exit, never dust.
const CLOSING_OUT_FRACTION_PERCENT = 95;

/** Chain order: slot first (a block time only has 1s resolution), then signature as a stable tiebreak. */
function chainOrder(a, b) {
  if (a.slot != null && b.slot != null && a.slot !== b.slot) return a.slot - b.slot;
  if (a.blockTime !== b.blockTime) return a.blockTime - b.blockTime;
  return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;
}

/** True if `a` happened strictly before `b` on chain. */
function isBefore(a, b) {
  if (a.signature === b.signature) return false;
  if (a.slot != null && b.slot != null) return a.slot < b.slot;
  return a.blockTime < b.blockTime;
}

/**
 * @param {Array<{signature:string, blockTime:number, slot:number|null, trades:Array}>} txs cached BacktestTx rows
 * @returns {Map<string, {mint:string, buys:object[], sells:object[]}>} oldest-first per mint, keyed by mint
 */
export function groupTradesByMint(txs) {
  const byMint = new Map();
  for (const tx of txs) {
    if (!tx.blockTime) continue;
    for (const t of tx.trades || []) {
      if (!t.mint || (t.type !== "buy" && t.type !== "sell")) continue;
      let entry = byMint.get(t.mint);
      if (!entry) byMint.set(t.mint, (entry = { mint: t.mint, buys: [], sells: [] }));
      (t.type === "buy" ? entry.buys : entry.sells).push({
        signature: tx.signature,
        blockTime: tx.blockTime,
        slot: tx.slot ?? null,
        tokenAmount: t.tokenAmount,
        solAmount: t.solAmount,
        isNativeSolQuote: t.isNativeSolQuote !== false,
      });
    }
  }
  for (const entry of byMint.values()) {
    entry.buys.sort(chainOrder);
    entry.sells.sort(chainOrder);
  }
  return byMint;
}

/**
 * The tokens worth backtesting, oldest first-buy first. A token with sells
 * but no buys inside the window is dropped: a sell with no earlier buy is
 * invalid (the trader's position predates the window, so there is nothing to copy).
 */
export function listSignals(byMint) {
  return [...byMint.values()]
    .filter((e) => e.buys.length > 0)
    .sort((a, b) => chainOrder(a.buys[0], b.buys[0]));
}

/**
 * First sell this strategy would act on, given it bought at `buy` and its
 * position opens at `fillTimeSec`. Mirrors engine.js evaluateSell:
 *  - must come after the buy, and after our position exists (a sell that lands
 *    before our delayed fill finds nothing to sell and is ignored);
 *  - a sell below `dustSellFractionPercent` of what the trader had bought so
 *    far is dust, unless it brings their cumulative sold amount to 95%+.
 * The fraction is measured against buys made BEFORE that sell, exactly what
 * the live tracker could have known at that moment.
 */
export function findTraderSell({ buys, sells, buy, fillTimeSec, dustSellFractionPercent }) {
  for (const sell of sells) {
    if (!isBefore(buy, sell)) continue;
    if (sell.blockTime < fillTimeSec) continue;

    const boughtSoFar = buys.filter((b) => isBefore(b, sell)).reduce((sum, b) => sum + (b.tokenAmount || 0), 0);
    const soldBefore = sells.filter((s) => isBefore(s, sell)).reduce((sum, s) => sum + (s.tokenAmount || 0), 0);
    const amount = sell.tokenAmount || 0;

    const soldFraction = boughtSoFar > 0 ? (amount / boughtSoFar) * 100 : 100;
    const cumulativeFraction = boughtSoFar > 0 ? ((soldBefore + amount) / boughtSoFar) * 100 : 100;
    const isClosingOut = cumulativeFraction >= CLOSING_OUT_FRACTION_PERCENT;
    const isDust = soldFraction < dustSellFractionPercent && !isClosingOut;
    if (!isDust) return sell;
  }
  return null;
}
