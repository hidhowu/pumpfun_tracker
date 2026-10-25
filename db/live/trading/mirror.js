import { LiveWallet } from "../../models/LiveWallet.js";
import { LiveLot } from "../../models/LiveLot.js";
import { LiveExecution } from "../../models/LiveExecution.js";
import { computeTradeFees } from "../../fees.js";
import { isTradingPaused } from "../../simulation/guards.js";

/**
 * The link between a simulation wallet and the live wallet connected to it. The simulation calls these from the places where it makes its own
 * decisions, so the live wallet acts on the SAME decision at the same moment - except that it does not wait out the simulated execution
 * delay (that delay only imitates how long a transaction takes; a live wallet really sends it). Each call only queues work
 * (LiveExecution); db/live/trading/executor.js does it.
 *
 *  - a buy is mirrored only if the simulation would take it right now (its balance covers the trade and the fees), so the two stay paired,
 *    and never while the live wallet is paused (exits and sells are not affected by the pause);
 *  - a trader's sell, and a blacklisting, are mirrored to whatever the live wallet holds from that trader;
 *  - a stop-loss / take-profit / trailing-stop / max-hold exit is mirrored only when the live wallet is set to FOLLOW the simulation's exits
 *    (a dry run always records the followed outcome next to the other styles' - even after its position has closed, because the style the wallet
 *    is set to decided first: db/live/trading/styles.js).
 */

/** A lot the exits still matter to: an open position, or a dry one whose styles have not all decided yet. */
const stillWorkedOn = { $or: [{ status: "open" }, { mode: "dry", dryDone: false }] };

const liveFor = (simWalletId) => LiveWallet.findOne({ connectedWalletId: simWalletId }, { _id: 1, tradingMode: 1, exitMode: 1, paused: 1 }).lean();

async function enqueue(fields) {
  try {
    await LiveExecution.create({ triggerAt: new Date(), ...fields });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // the same thing is already queued
    throw err;
  }
}

/** Does the live wallet hold, or is it about to hold, something from this trader in this token? */
export async function liveHolds(simWalletId, traderAddress, mint) {
  const live = await liveFor(simWalletId);
  if (!live) return null;
  const lot = await LiveLot.exists({ liveWalletId: live._id, traderAddress, mint, ...stillWorkedOn });
  if (lot) return live;
  const buying = await LiveExecution.exists({ liveWalletId: live._id, traderAddress, mint, action: "buy", status: { $in: ["pending", "processing"] } });
  return buying ? live : null;
}

/** @param {object} wallet the simulation wallet (with its current balance) @param {object} walletTrader @param {object} trade the trader's buy */
export async function mirrorBuy(wallet, walletTrader, trade) {
  const live = await liveFor(wallet._id);
  if (!live || live.paused) return false;
  const settings = wallet.settings;
  const simCost = settings.tradeSizeUsd + computeTradeFees(settings.tradeSizeUsd, settings).totalFeeUsd;
  if (wallet.balanceUsd < simCost) return false; // the simulation can't take it, so the live wallet doesn't either
  if (await isTradingPaused()) return false;
  if (await LiveLot.exists({ liveWalletId: live._id, traderAddress: walletTrader.traderAddress, mint: trade.mint })) return false;
  return enqueue({
    liveWalletId: live._id,
    walletId: wallet._id,
    traderAddress: walletTrader.traderAddress,
    mint: trade.mint,
    action: "buy",
    sourceSignature: trade.signature,
    idemKey: `buy:${walletTrader.traderAddress}:${trade.mint}:${trade.signature}`,
  });
}

/** The trader sold (and it was not dust): sell what this trader's lot holds. */
export async function mirrorSell(wallet, traderAddress, trade) {
  const live = await liveHolds(wallet._id, traderAddress, trade.mint);
  if (!live) return false;
  return enqueue({
    liveWalletId: live._id,
    walletId: wallet._id,
    traderAddress,
    mint: trade.mint,
    action: "sell",
    closeReason: "trader_sell",
    track: null,
    sourceSignature: trade.signature,
    idemKey: `sell:${traderAddress}:${trade.mint}:${trade.signature}`,
  });
}

/**
 * The simulation decided to exit a position (stop-loss, take-profit, trailing stop, max hold, or its trader was blacklisted).
 * @param {{ walletId: any, traderAddress: string, mint: string, _id: any }} position the simulated position
 */
export async function mirrorExit(position, closeReason) {
  const live = await liveFor(position.walletId);
  if (!live) return false;
  const lot = await LiveLot.findOne({ liveWalletId: live._id, traderAddress: position.traderAddress, mint: position.mint, ...stillWorkedOn }, { mode: 1, dryExits: 1 }).lean();
  if (!lot) return false;
  const blacklisted = closeReason === "blacklisted";
  let track = null; // null = the live position itself (live lot), or every way at once (dry-run lot)
  if (lot.mode === "live") {
    if (!blacklisted && live.exitMode !== "follow") return false; // the live wallet judges these itself
  } else if (!blacklisted) {
    if (lot.dryExits?.follow) return false; // already recorded
    track = "follow"; // a dry run records what following the simulation would have done
  }
  return enqueue({
    liveWalletId: live._id,
    walletId: position.walletId,
    traderAddress: position.traderAddress,
    mint: position.mint,
    action: "sell",
    closeReason,
    track,
    sourceSignature: `exit:${closeReason}:${position._id}`,
  });
}
