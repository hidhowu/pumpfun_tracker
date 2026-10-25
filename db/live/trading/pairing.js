import { WalletPosition } from "../../models/WalletPosition.js";
import { WalletPendingExecution } from "../../models/WalletPendingExecution.js";

/**
 * Did the simulation take the trade a live lot copied? Its buy can be skipped (e.g. pump.fun's trades API has no trade for a brand-new token yet) or
 * never made (its balance ran out); then there is no simulated exit to follow and "follow" is judged like "own" (db/live/trading/styles.js).
 * A lot counts as unpaired only when the simulation has no position for it AND no buy of it still waiting - a buy still in the queue may yet fill.
 * @param {object[]} lots LiveLot documents
 * @returns {Promise<object[]>} the ones the simulation did not take
 */
export async function findUnpaired(lots) {
  if (lots.length === 0) return [];
  const query = { walletId: { $in: lots.map((l) => l.walletId) }, mint: { $in: lots.map((l) => l.mint) } };
  const [positions, pending] = await Promise.all([
    WalletPosition.find(query, { walletId: 1, traderAddress: 1, mint: 1, openedAt: 1 }).lean(),
    WalletPendingExecution.find({ ...query, action: "buy", status: { $in: ["pending", "processing"] } }, { walletId: 1, traderAddress: 1, mint: 1 }).lean(),
  ]);
  const same = (p, l) => String(p.walletId) === String(l.walletId) && p.traderAddress === l.traderAddress && p.mint === l.mint;
  // The simulated position opens a moment after its live lot (the lot has no execution delay).
  return lots.filter(
    (l) => !positions.some((p) => same(p, l) && p.openedAt >= l.openedAt.getTime() - 30_000 && p.openedAt <= l.openedAt.getTime() + 180_000) && !pending.some((p) => same(p, l))
  );
}
