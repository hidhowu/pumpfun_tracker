/**
 * Money maths of a live lot, in one place. A lot's cost is what really left the wallet for the swap, the Jito tip and the network fee;
 * what it pays back is the swap's payout less the tip and the fee of the selling transaction. The token-account deposit is neither:
 * it is returned when the account is burned, so it stays in the wallet's balance and never shows up as profit or loss.
 */

const LAMPORTS = 1e9;

/** The smallest unit of one whole token. */
export const oneToken = (decimals) => 10n ** BigInt(decimals ?? 6);

/** Dollars a buy leg cost in total. */
export function buyCostUsd(buy) {
  const lamports = (buy.swapLamports || 0) + (buy.tipLamports || 0) + (buy.feeLamports || 0);
  return (lamports / LAMPORTS) * (buy.solUsd || 0);
}

/** Dollars a sell leg paid back after its tip and network fee (can be below zero for a tiny sale). */
export function sellNetUsd(sell) {
  const lamports = (sell.swapLamports || 0) - (sell.tipLamports || 0) - (sell.feeLamports || 0);
  return (lamports / LAMPORTS) * (sell.solUsd || 0);
}

/** @returns {{ costUsd: number, proceedsUsd: number, realizedPnlUsd: number, realizedPnlPercent: number }} */
export function settle(buy, sell) {
  const costUsd = buyCostUsd(buy);
  const proceedsUsd = sellNetUsd(sell);
  const realizedPnlUsd = proceedsUsd - costUsd;
  return { costUsd, proceedsUsd, realizedPnlUsd, realizedPnlPercent: costUsd > 0 ? (realizedPnlUsd / costUsd) * 100 : 0 };
}

/** Dollars per whole token for a swap that moved `lamports` of SOL against `tokenRaw` tokens. */
export function swapPriceUsd(lamports, tokenRaw, decimals, solUsd) {
  const tokens = Number(tokenRaw) / 10 ** (decimals ?? 6);
  return tokens > 0 && solUsd ? ((lamports / LAMPORTS) * solUsd) / tokens : null;
}

/** What a whole lot is worth right now at `priceUsd` per token, before the cost of selling it. */
export function lotValueUsd(lot, priceUsd) {
  return (Number(lot.tokenRaw) / 10 ** (lot.decimals ?? 6)) * priceUsd;
}
