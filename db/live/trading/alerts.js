import { LiveLot } from "../../models/LiveLot.js";
import { LiveWallet } from "../../models/LiveWallet.js";
import { logEvent } from "../../systemLog.js";

/**
 * A sell that could not be completed. The position is still held, so it is the one failure that needs a human: it is marked on the lot
 * (`sellFailure`), which the live wallet pages show as a red banner with a "Sell now" button, and logged as an ERROR.
 *
 * Telegram (or any other push) belongs in `notifySellFailure`: it is called once each time a sell gives up.
 */

/** Called each time a sell gives up on a lot. Today it only logs; a Telegram message would be sent from here. */
export async function notifySellFailure({ liveWallet, lot, reason }) {
  logEvent("trade", `[live] SELL FAILED - "${liveWallet?.name ?? lot.liveWalletId}" still holds ${lot.mint} (trader ${lot.traderAddress}): ${reason}. Sell it by hand or press "Sell now".`, {
    level: "error",
    meta: { liveWalletId: String(lot.liveWalletId), mint: lot.mint, traderAddress: lot.traderAddress, reason },
  });
}

/** Marks the open lot a sell gave up on. */
export async function flagSellFailure(item, reason) {
  const lot = await LiveLot.findOneAndUpdate(
    { liveWalletId: item.liveWalletId, traderAddress: item.traderAddress, mint: item.mint, status: "open", mode: "live" },
    [{ $set: { sellFailure: { at: new Date(), reason, closeReason: item.closeReason ?? null, failures: { $add: [{ $ifNull: ["$sellFailure.failures", 0] }, 1] } } } }],
    { returnDocument: "after", updatePipeline: true }
  );
  if (!lot) return null;
  const liveWallet = await LiveWallet.findById(item.liveWalletId, { name: 1 }).lean();
  await notifySellFailure({ liveWallet, lot, reason }).catch(() => {});
  return lot;
}

/** Open live positions whose sell gave up, for one wallet or all of them. */
export async function listStuckSells(liveWalletId = null) {
  const lots = await LiveLot.find({ ...(liveWalletId ? { liveWalletId } : {}), status: "open", mode: "live", sellFailure: { $ne: null } }, { liveWalletId: 1, mint: 1, traderAddress: 1, sellFailure: 1, openedAt: 1 })
    .sort({ "sellFailure.at": -1 })
    .lean();
  return lots;
}
