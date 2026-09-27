/**
 * Given the output of parseTransaction(), pulls out just the pump.fun /
 * pump.fun-amm buy or sell trades — the thing the tracker actually cares
 * about. Returns [] if the transaction contains no pump.fun buy/sell
 * (i.e. it's not a "valid" trade for tracking purposes).
 *
 * If `forAddress` is given (the wallet you're tracking via logsSubscribe),
 * amounts are anchored to *that* wallet's own balance changes rather than
 * whichever account the pump.fun event happened to name as "user" — this
 * matters for router/aggregator transactions where the pump.fun instruction
 * is executed on behalf of a vault/PDA that then forwards funds onward.
 *
 * The solAmount is preferably read straight from the pump.fun event
 * (exact, fee-inclusive). But when a trade is not quoted in native SOL
 * (e.g. it was routed token-A -> token-B -> SOL, or the pump.fun pool/curve
 * is quoted in a non-SOL token), the event's own SOL amount is 0 or
 * meaningless — in that case we fall back to the wallet's actual net SOL
 * balance change for the transaction, which reflects what really happened
 * to their SOL regardless of how many hops it took.
 */

const PUMP_PROGRAMS = new Set(["pump.fun", "pump.fun-amm"]);

function findTokenRow(tokenBalanceChanges, wallet, mint) {
  return tokenBalanceChanges.find((r) => r.owner === wallet && r.mint === mint) || null;
}

function findSolRow(solBalanceChanges, wallet) {
  return solBalanceChanges.find((r) => r.account === wallet) || null;
}

/**
 * @param {{summary: object}} parsed - result of parseTransaction()
 * @param {{forAddress?: string}} [opts]
 * @returns {Array<object>} zero or more trade records
 */
export function extractPumpTrades(parsed, { forAddress } = {}) {
  const { summary } = parsed;
  const trades = [];

  for (const event of summary.events) {
    if (event.type !== "buy" && event.type !== "sell") continue;
    if (!PUMP_PROGRAMS.has(event.program)) continue;

    const wallet = forAddress || event.wallet;

    const tokenRow = findTokenRow(summary.tokenBalanceChanges, wallet, event.mint);
    const solRow = findSolRow(summary.solBalanceChanges, wallet);

    // If we're anchoring to a specific tracked address and it had no
    // balance change tied to this particular event's mint, this event
    // isn't actually about that address — skip it rather than mislabel it.
    if (forAddress && wallet !== event.wallet && !tokenRow) continue;

    const tokenAmount = tokenRow ? Math.abs(tokenRow.deltaUi) : event.tokenAmount ?? null;

    let solAmount = null;
    let solAmountSource = null;
    if (event.isNativeSolQuote && typeof event.solAmount === "number" && event.solAmount > 0) {
      solAmount = event.solAmount;
      solAmountSource = "event";
    } else if (solRow) {
      solAmount = Math.abs(solRow.deltaSol);
      solAmountSource = "wallet_balance_delta";
    } else if (typeof event.solAmount === "number") {
      solAmount = event.solAmount;
      solAmountSource = "event";
    }

    trades.push({
      signature: summary.signature,
      slot: summary.slot,
      blockTime: summary.blockTime,
      type: event.type,
      program: event.program,
      mint: event.mint,
      wallet,
      tokenAmount,
      solAmount,
      solAmountSource,
      isNativeSolQuote: event.isNativeSolQuote,
      quoteMint: event.quoteMint,
      feePayer: summary.feePayer,
    });
  }

  return trades;
}
