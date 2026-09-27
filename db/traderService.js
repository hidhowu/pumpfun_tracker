import bs58 from "bs58";
import { Trader } from "./models/Trader.js";
import { BalanceAdjustment } from "./models/BalanceAdjustment.js";
import { SimPosition } from "./models/SimPosition.js";
import { PendingExecution } from "./models/PendingExecution.js";
import { DailySnapshot } from "./models/DailySnapshot.js";
import { ensureTraderInitialized } from "./simulation/init.js";
import { resolveTraderSettings } from "./settings.js";

/**
 * A Solana address is a base58-encoded 32-byte public key. Rejecting
 * malformed ones here (rather than letting them reach the tracker) matters:
 * an invalid address passed to logsSubscribe fails every single time the
 * tracker's DB-poll tries to (re)watch it, forever, spamming "Invalid
 * mentions provided" errors on every poll cycle - this is exactly what
 * happened when a placeholder/test string ended up in the Trader
 * collection.
 */
export function isValidSolanaAddress(address) {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) return false;
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}

/**
 * Adds one trader. If the address is already tracked, it's silently
 * ignored (no error, no duplicate) - returns { added: false } instead.
 * Initializes their simulated starting balance immediately (from whatever
 * allocationUsd resolves to right now).
 */
export async function addTrader(address, { label = "" } = {}) {
  if (!isValidSolanaAddress(address)) return { added: false, invalid: true };
  const existing = await Trader.findOne({ address });
  if (existing) return { added: false, trader: existing };
  const trader = await Trader.create({ address, label });
  await ensureTraderInitialized(trader);
  return { added: true, trader };
}

/**
 * Bulk add. Duplicates (already-tracked addresses) are silently skipped -
 * they're returned in `skipped` for the caller to show a summary, but this
 * never throws or stops the rest of the batch from being added. Duplicates
 * *within* the same submitted list are also collapsed to one. Entries that
 * aren't valid Solana addresses are rejected into `invalid` rather than
 * ever reaching the tracker (see isValidSolanaAddress above for why).
 *
 * @param {Array<string|{address: string, label?: string}>} entries
 */
export async function addTradersBulk(entries) {
  const normalized = entries
    .map((e) => (typeof e === "string" ? { address: e.trim(), label: "" } : { address: e.address?.trim(), label: e.label || "" }))
    .filter((e) => e.address);

  const invalid = normalized.filter((e) => !isValidSolanaAddress(e.address)).map((e) => e.address);
  const validEntries = normalized.filter((e) => isValidSolanaAddress(e.address));

  const seenInBatch = new Set();
  const deduped = [];
  for (const entry of validEntries) {
    if (seenInBatch.has(entry.address)) continue;
    seenInBatch.add(entry.address);
    deduped.push(entry);
  }

  const existingDocs = await Trader.find({ address: { $in: deduped.map((e) => e.address) } }, { address: 1 }).lean();
  const existingAddresses = new Set(existingDocs.map((d) => d.address));

  const toInsert = deduped.filter((e) => !existingAddresses.has(e.address));
  const skipped = deduped.filter((e) => existingAddresses.has(e.address)).map((e) => e.address);

  let added = [];
  if (toInsert.length > 0) {
    const docs = await Trader.insertMany(
      toInsert.map((e) => ({ address: e.address, label: e.label })),
      { ordered: false }
    );
    for (const doc of docs) await ensureTraderInitialized(doc);
    added = docs.map((d) => d.address);
  }

  return { added, skipped, invalid };
}

export async function setBlacklisted(address, blacklisted) {
  return Trader.findOneAndUpdate(
    { address },
    { status: blacklisted ? "blacklisted" : "active", blacklistedAt: blacklisted ? new Date() : null },
    { returnDocument: "after" }
  );
}

export async function setMuted(address, muted) {
  // muted: true | false | null (null clears the override, falling back to the global default)
  return Trader.findOneAndUpdate({ address }, { muted }, { returnDocument: "after" });
}

export async function setTraderMeta(address, { label, notes } = {}) {
  const update = {};
  if (label !== undefined) update.label = label;
  if (notes !== undefined) update.notes = notes;
  return Trader.findOneAndUpdate({ address }, update, { returnDocument: "after" });
}

/**
 * Per-trader simulation setting overrides. Pass `null` for a field to clear
 * the override (fall back to the global default) - see db/settings.js.
 */
export async function setTraderSimSettings(address, patch) {
  const update = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) update[`settings.${key}`] = value;
  }
  return Trader.findOneAndUpdate({ address }, { $set: update }, { returnDocument: "after" });
}

/** Manual balance top-up/deduction, with an audit trail (db/models/BalanceAdjustment.js). */
export async function adjustBalance(address, amountUsd, reason = "") {
  const trader = await Trader.findOne({ address });
  if (!trader) throw new Error("Trader not found");
  await ensureTraderInitialized(trader);

  const updated = await Trader.findOneAndUpdate(
    { address },
    { $inc: { "sim.balanceUsd": amountUsd } },
    { returnDocument: "after" }
  );
  await BalanceAdjustment.create({ traderAddress: address, amountUsd, reason, balanceAfterUsd: updated.sim.balanceUsd });
  return updated;
}

/**
 * Full simulation reset for one trader: wipes every open/closed position,
 * pending execution, daily snapshot, and balance-adjustment record, then
 * resets balance back to their current effective starting allocation - as
 * if we'd just started tracking them fresh. Does NOT touch `Trade` (the
 * real on-chain trades we've observed from them), `label`/`notes`, or
 * `status` - this only resets simulation state, not the trader record
 * itself or the on-chain history we've recorded.
 */
export async function resetTraderSimulation(address) {
  const trader = await Trader.findOne({ address });
  if (!trader) throw new Error("Trader not found");

  const settings = await resolveTraderSettings(trader);

  await Promise.all([
    SimPosition.deleteMany({ traderAddress: address }),
    PendingExecution.deleteMany({ traderAddress: address }),
    DailySnapshot.deleteMany({ traderAddress: address }),
    BalanceAdjustment.deleteMany({ traderAddress: address }),
  ]);

  return Trader.findOneAndUpdate(
    { address },
    {
      $set: {
        sim: {
          initialized: true,
          startingAllocationUsd: settings.allocationUsd,
          balanceUsd: settings.allocationUsd,
          everBoughtMints: [],
          negativeBalanceEventCount: 0,
          maxNegativeBalanceUsd: 0,
          openPositionCount: 0,
          closedPositionCount: 0,
          realizedPnlUsd: 0,
          lastActionAt: null,
        },
      },
    },
    { returnDocument: "after" }
  );
}

/** Resets simulation state for every active (non-blacklisted) trader. Returns the list of reset addresses. */
export async function resetAllTradersSimulation() {
  const traders = await Trader.find({ status: "active" }, { address: 1 }).lean();
  for (const trader of traders) {
    await resetTraderSimulation(trader.address);
  }
  return traders.map((t) => t.address);
}
