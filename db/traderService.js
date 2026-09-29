import bs58 from "bs58";
import { Trader } from "./models/Trader.js";
import { ProfileTrader } from "./models/ProfileTrader.js";
import { BalanceAdjustment } from "./models/BalanceAdjustment.js";
import { SimPosition } from "./models/SimPosition.js";
import { PendingExecution } from "./models/PendingExecution.js";
import { DailySnapshot } from "./models/DailySnapshot.js";
import { NegativeBalanceEvent } from "./models/NegativeBalanceEvent.js";
import { resolveTraderSettings } from "./settings.js";
import { ensureTraderInitialized } from "./simulation/init.js";

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
 * Adds one trader (shared identity, unaffected by profiles). If the address
 * is already tracked, it's silently ignored (no error, no duplicate) -
 * returns { added: false } instead. Each profile lazily initializes its own
 * simulated balance for this address the first time it evaluates/tracks it
 * (see db/simulation/init.js) - no eager per-profile write needed here.
 */
export async function addTrader(address, { label = "" } = {}) {
  if (!isValidSolanaAddress(address)) return { added: false, invalid: true };
  const existing = await Trader.findOne({ address });
  if (existing) return { added: false, trader: existing };
  const trader = await Trader.create({ address, label });
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

/** muted: true | false | null (null clears the override, falling back to the shared default) - shared across every profile, not per-profile (a wallet's notification preference isn't a strategy choice). */
export async function setMuted(address, muted) {
  return Trader.findOneAndUpdate({ address }, { muted }, { returnDocument: "after" });
}

export async function setTraderMeta(address, { label, notes } = {}) {
  const update = {};
  if (label !== undefined) update.label = label;
  if (notes !== undefined) update.notes = notes;
  return Trader.findOneAndUpdate({ address }, update, { returnDocument: "after" });
}

/**
 * Per-(profile, trader) simulation setting overrides. Pass `null` for a
 * field to clear the override (fall back to that profile's global default)
 * - see db/settings.js. Upserts the ProfileTrader row since it may not
 * exist yet (lazily created otherwise on first evaluation).
 */
export async function setTraderSimSettings(profileId, address, patch) {
  const update = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) update[`settings.${key}`] = value;
  }
  return ProfileTrader.findOneAndUpdate(
    { profileId, traderAddress: address },
    { $set: update },
    { returnDocument: "after", upsert: true }
  );
}

/** Manual balance top-up/deduction for one trader within one profile, with an audit trail (db/models/BalanceAdjustment.js). */
export async function adjustBalance(profileId, address, amountUsd, reason = "") {
  let profileTrader = await ProfileTrader.findOne({ profileId, traderAddress: address });
  if (!profileTrader) profileTrader = await ensureTraderInitialized(profileId, address);

  const updated = await ProfileTrader.findOneAndUpdate(
    { profileId, traderAddress: address },
    { $inc: { "sim.balanceUsd": amountUsd } },
    { returnDocument: "after" }
  );
  await BalanceAdjustment.create({ profileId, traderAddress: address, amountUsd, reason, balanceAfterUsd: updated.sim.balanceUsd });
  return updated;
}

/**
 * Full simulation reset for one trader, within one profile: wipes every
 * open/closed position, pending execution, daily snapshot, balance-
 * adjustment record, and negative-balance event for this (profile, trader)
 * pair, then resets balance back to that profile's current effective
 * starting allocation - as if this profile had just started tracking this
 * trader fresh. Does NOT touch `Trade` (the real on-chain trades we've
 * observed from them - shared, unaffected by any profile), `label`/`notes`,
 * or `status` - this only resets simulation state, not the trader record
 * itself, and only within THIS profile (other profiles' state is untouched).
 */
export async function resetTraderSimulation(profileId, address) {
  const settings = await resolveTraderSettings(profileId, address);

  await Promise.all([
    SimPosition.deleteMany({ profileId, traderAddress: address }),
    PendingExecution.deleteMany({ profileId, traderAddress: address }),
    DailySnapshot.deleteMany({ profileId, traderAddress: address }),
    BalanceAdjustment.deleteMany({ profileId, traderAddress: address }),
    NegativeBalanceEvent.deleteMany({ profileId, traderAddress: address }),
  ]);

  return ProfileTrader.findOneAndUpdate(
    { profileId, traderAddress: address },
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
    { returnDocument: "after", upsert: true }
  );
}

/** Resets simulation state for every active (non-blacklisted) trader, within one profile. Returns the list of reset addresses. */
export async function resetAllTradersSimulation(profileId) {
  const traders = await Trader.find({ status: "active" }, { address: 1 }).lean();
  for (const trader of traders) {
    await resetTraderSimulation(profileId, trader.address);
  }
  return traders.map((t) => t.address);
}
