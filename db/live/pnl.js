/**
 * Profit and loss for a live wallet, folded from its stored transaction rows (db/models/LiveWalletTx.js). Pure.
 *
 * Average-cost method, per token, oldest transaction first:
 *  - a buy adds tokens and adds its SOL cost (what left the wallet for the swap, plus the network fee);
 *  - a sell realises (proceeds - average cost of the tokens sold); proceeds are what reached the wallet minus the fee;
 *  - tokens that arrive by plain transfer carry no cost, and tokens sent away leave at average cost with no profit or
 *    loss, because no price was paid or received.
 * Everything is tracked in SOL, which is exact; USD is each sell's SOL result at the SOL/USD recorded when it was synced.
 */

export function emptyStats() {
  return {
    buys: 0,
    sells: 0,
    boughtSol: 0, // total SOL spent on buys
    soldSol: 0, // total SOL received from sells
    realizedPnlSol: 0,
    realizedPnlUsd: 0,
    profitUsd: 0, // sum of winning sells
    lossUsd: 0, // sum of losing sells (negative)
    profitSol: 0,
    lossSol: 0,
    wins: 0,
    losses: 0,
  };
}

/**
 * @param rows chronological (oldest first), each with kind/mint/tokenDelta/solDelta/feeSol/solUsd
 * @param fallbackSolUsd used for rows synced without a SOL price
 * @returns {{ rows: object[], perMint: Map<string, object>, totals: object }}
 */
export function buildLedger(rows, fallbackSolUsd = null) {
  const positions = new Map(); // mint -> { qty, costSol }
  const perMint = new Map(); // mint -> stats
  const totals = emptyStats();
  const out = [];

  for (const r of rows) {
    const solUsd = r.solUsd ?? fallbackSolUsd ?? null;
    const item = { ...r, solUsd, costBasisSol: null, valueSol: null, realizedPnlSol: null, realizedPnlPct: null, realizedPnlUsd: null };

    if (r.mint && (r.kind === "buy" || r.kind === "sell" || r.kind === "receive" || r.kind === "send")) {
      const pos = positions.get(r.mint) ?? { qty: 0, costSol: 0 };
      const stats = perMint.get(r.mint) ?? emptyStats();
      positions.set(r.mint, pos);
      perMint.set(r.mint, stats);

      if (r.kind === "buy") {
        const cost = -r.solDelta + r.feeSol;
        pos.qty += r.tokenDelta;
        pos.costSol += cost;
        item.valueSol = cost;
        for (const s of [stats, totals]) {
          s.buys += 1;
          s.boughtSol += cost;
        }
      } else if (r.kind === "receive") {
        pos.qty += r.tokenDelta;
      } else {
        const sold = -r.tokenDelta;
        const covered = Math.min(sold, pos.qty); // tokens we know the cost of
        const avg = pos.qty > 0 ? pos.costSol / pos.qty : 0;
        const costBasis = avg * covered;
        pos.qty -= covered;
        pos.costSol -= costBasis;
        if (pos.qty < 1e-12) pos.qty = 0;
        if (pos.qty === 0) pos.costSol = 0;

        if (r.kind === "sell") {
          const proceeds = r.solDelta - r.feeSol;
          const pnlSol = proceeds - costBasis;
          const pnlUsd = solUsd === null ? null : pnlSol * solUsd;
          Object.assign(item, {
            valueSol: proceeds,
            costBasisSol: costBasis,
            realizedPnlSol: pnlSol,
            realizedPnlPct: costBasis > 0 ? (pnlSol / costBasis) * 100 : null,
            realizedPnlUsd: pnlUsd,
          });
          for (const s of [stats, totals]) {
            s.sells += 1;
            s.soldSol += proceeds;
            s.realizedPnlSol += pnlSol;
            s.realizedPnlUsd += pnlUsd ?? 0;
            if (pnlSol > 0) {
              s.wins += 1;
              s.profitSol += pnlSol;
              s.profitUsd += pnlUsd ?? 0;
            } else if (pnlSol < 0) {
              s.losses += 1;
              s.lossSol += pnlSol;
              s.lossUsd += pnlUsd ?? 0;
            }
          }
        }
      }
    }
    out.push(item);
  }

  for (const [mint, pos] of positions) {
    const stats = perMint.get(mint);
    stats.heldQty = pos.qty;
    stats.heldCostSol = pos.costSol;
    stats.avgCostSol = pos.qty > 0 ? pos.costSol / pos.qty : null;
  }
  return { rows: out, perMint, totals };
}
