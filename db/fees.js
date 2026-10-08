/**
 * Trade-fee model shared by both simulations (Profile-scoped executor.js and
 * Wallet-scoped walletExecutor.js).
 *
 * Every simulated buy AND every simulated sell pays two fees:
 *
 *  - Pump fee: a percentage of the trade's notional USD value. pump.fun
 *    charges this on-chain on both sides of the bonding curve - verified
 *    against real mainnet buys/sells: 0.95% protocol fee + 0.30% creator fee
 *    = 1.25% of the SOL amount, on the buy (added on top of what goes into
 *    the curve) and on the sell (taken out of the curve's payout).
 *  - Jito fee: a flat USD amount per transaction (tip + priority fee) - what
 *    it costs to actually land the transaction, independent of its size.
 *
 * Buy:  notional = trade size;   fee = notional * pump% + jito  (paid on top)
 * Sell: notional = gross proceeds; fee = notional * pump% + jito (taken out)
 */
export const DEFAULT_PUMP_FEE_PERCENT = 1.25;
export const DEFAULT_JITO_FEE_USD = 0;

function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** { pumpFeeUsd, jitoFeeUsd, totalFeeUsd } for one buy or sell of `notionalUsd`. */
export function computeTradeFees(notionalUsd, { pumpFeePercent, jitoFeeUsd } = {}) {
  const pct = Math.max(0, finiteOr(pumpFeePercent, DEFAULT_PUMP_FEE_PERCENT));
  const jito = Math.max(0, finiteOr(jitoFeeUsd, DEFAULT_JITO_FEE_USD));
  const pumpFeeUsd = Math.max(0, notionalUsd) * (pct / 100);
  return { pumpFeeUsd, jitoFeeUsd: jito, totalFeeUsd: pumpFeeUsd + jito };
}

/**
 * How much a position's close should move the RUNNING realized-P&L counters
 * (Wallet/WalletTrader/ProfileTrader.realizedPnlUsd). Positions opened under
 * this fee model book their buy fee into those counters the moment the buy
 * fills (buyFeeRealizedAtOpen: true), so at close only the remainder is
 * added - otherwise the buy fee would be counted twice. Positions opened
 * before this existed never booked it early, so their full realized P&L is
 * added at close, exactly as before.
 */
export function realizedCounterDeltaOnClose(position, realizedPnlUsd) {
  return position.buyFeeRealizedAtOpen ? realizedPnlUsd + (position.buyFeeUsd || 0) : realizedPnlUsd;
}
