import { Profile } from "./models/Profile.js";
import { GlobalSettings } from "./models/GlobalSettings.js";
import { ProfileTrader } from "./models/ProfileTrader.js";
import { SimPosition } from "./models/SimPosition.js";
import { PendingExecution } from "./models/PendingExecution.js";
import { DailySnapshot } from "./models/DailySnapshot.js";
import { BalanceAdjustment } from "./models/BalanceAdjustment.js";
import { NegativeBalanceEvent } from "./models/NegativeBalanceEvent.js";

/** Copies every field of a lean document except _id/__v/profileId, for re-inserting under a new profileId. */
function stripDocMeta(doc) {
  // eslint-disable-next-line no-unused-vars
  const { _id, __v, profileId, ...rest } = doc;
  return rest;
}

/**
 * Creates a new Profile - an independent simulation strategy over the same
 * shared tracked wallets. Two modes:
 *
 *  - "fresh": copies `sourceProfileId`'s GlobalSettings (or the built-in
 *    schema defaults if no source given) as a configuration starting
 *    point, but starts with a completely clean simulated wallet for every
 *    trader - no positions, no history, nothing. Every ProfileTrader row is
 *    created lazily from here (see db/simulation/init.js), exactly like the
 *    very first profile started.
 *  - "clone": deep-copies `sourceProfileId`'s ENTIRE current state - its
 *    GlobalSettings, every ProfileTrader (settings + simulated wallet,
 *    including balance and permanent per-mint dedup), every open/closed
 *    SimPosition, every still-pending PendingExecution, every DailySnapshot,
 *    BalanceAdjustment, and NegativeBalanceEvent - into new documents under
 *    the new profileId. An exact fork of the source profile at this exact
 *    moment, which then diverges as you change its settings.
 *
 * @param {{name: string, mode: "fresh"|"clone", sourceProfileId?: string}} opts
 */
export async function createProfile({ name, mode, sourceProfileId }) {
  if (mode === "clone" && !sourceProfileId) {
    throw new Error("sourceProfileId is required when mode is 'clone'");
  }

  const profile = await Profile.create({ name, isDefault: false });

  if (mode === "fresh") {
    const sourceSettings = sourceProfileId
      ? await GlobalSettings.findOne({ profileId: sourceProfileId }).lean()
      : null;
    await GlobalSettings.create({
      profileId: profile._id,
      ...(sourceSettings ? stripDocMeta(sourceSettings) : {}),
    });
    return profile;
  }

  // mode === "clone"
  const [sourceGlobalSettings, profileTraders, positions, pendingExecutions, dailySnapshots, balanceAdjustments, negativeBalanceEvents] =
    await Promise.all([
      GlobalSettings.findOne({ profileId: sourceProfileId }).lean(),
      ProfileTrader.find({ profileId: sourceProfileId }).lean(),
      SimPosition.find({ profileId: sourceProfileId }).lean(),
      PendingExecution.find({ profileId: sourceProfileId, status: { $in: ["pending", "processing"] } }).lean(),
      DailySnapshot.find({ profileId: sourceProfileId }).lean(),
      BalanceAdjustment.find({ profileId: sourceProfileId }).lean(),
      NegativeBalanceEvent.find({ profileId: sourceProfileId }).lean(),
    ]);

  await GlobalSettings.create({
    profileId: profile._id,
    ...(sourceGlobalSettings ? stripDocMeta(sourceGlobalSettings) : {}),
  });

  const insertIfAny = (Model, docs) =>
    docs.length > 0 ? Model.insertMany(docs.map((d) => ({ ...stripDocMeta(d), profileId: profile._id }))) : Promise.resolve();

  await Promise.all([
    insertIfAny(ProfileTrader, profileTraders),
    insertIfAny(SimPosition, positions),
    insertIfAny(PendingExecution, pendingExecutions),
    insertIfAny(DailySnapshot, dailySnapshots),
    insertIfAny(BalanceAdjustment, balanceAdjustments),
    insertIfAny(NegativeBalanceEvent, negativeBalanceEvents),
  ]);

  return profile;
}

export async function renameProfile(profileId, name) {
  return Profile.findOneAndUpdate({ _id: profileId }, { $set: { name } }, { returnDocument: "after" });
}

/**
 * Makes `profileId` THE default profile (exactly one ever has isDefault).
 * The default is what the app falls back to when no profile is selected, and
 * it can't be deleted - so moving the default elsewhere is how the old
 * default becomes deletable.
 */
export async function setDefaultProfile(profileId) {
  const profile = await Profile.findById(profileId);
  if (!profile) throw new Error("Profile not found");
  // Set the new one first: if the second write fails there are briefly two
  // defaults (harmless - every reader takes the first), never zero.
  await Profile.updateOne({ _id: profileId }, { $set: { isDefault: true } });
  await Profile.updateMany({ _id: { $ne: profileId }, isDefault: true }, { $set: { isDefault: false } });
  return Profile.findById(profileId);
}

/**
 * Every profile plus headline numbers for the Profiles page, from a few
 * aggregate queries across ALL profiles at once (not per profile):
 * realized P&L (lifetime, after fees), today's realized P&L, open trades,
 * total sim balance, closed-trade count and win rate.
 */
export async function listProfilesOverview() {
  const dayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [profiles, traderStats, openCounts, closedStats, todayStats] = await Promise.all([
    Profile.find({}).sort({ createdAt: 1 }).lean(),
    ProfileTrader.aggregate([
      {
        $group: {
          _id: "$profileId",
          realizedPnlUsd: { $sum: "$sim.realizedPnlUsd" },
          balanceUsd: { $sum: "$sim.balanceUsd" },
          startingBalanceUsd: { $sum: "$sim.startingAllocationUsd" },
          traderCount: { $sum: 1 },
        },
      },
    ]),
    SimPosition.aggregate([{ $match: { status: "open" } }, { $group: { _id: "$profileId", count: { $sum: 1 } } }]),
    SimPosition.aggregate([
      { $match: { status: "closed" } },
      {
        $group: {
          _id: "$profileId",
          closed: { $sum: 1 },
          wins: { $sum: { $cond: [{ $gt: ["$realizedPnlUsd", 0] }, 1, 0] } },
          losses: { $sum: { $cond: [{ $lt: ["$realizedPnlUsd", 0] }, 1, 0] } },
        },
      },
    ]),
    SimPosition.aggregate([
      { $match: { status: "closed", closedAt: { $gte: dayStart } } },
      { $group: { _id: "$profileId", pnl: { $sum: "$realizedPnlUsd" }, count: { $sum: 1 } } },
    ]),
  ]);

  const by = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const traders = by(traderStats);
  const open = by(openCounts);
  const closed = by(closedStats);
  const today = by(todayStats);

  return profiles.map((p) => {
    const id = String(p._id);
    const c = closed.get(id);
    const decided = (c?.wins || 0) + (c?.losses || 0);
    return {
      ...p,
      realizedPnlUsd: traders.get(id)?.realizedPnlUsd || 0,
      todayRealizedPnlUsd: today.get(id)?.pnl || 0,
      todayClosedTrades: today.get(id)?.count || 0,
      balanceUsd: traders.get(id)?.balanceUsd || 0,
      startingBalanceUsd: traders.get(id)?.startingBalanceUsd || 0,
      traderCount: traders.get(id)?.traderCount || 0,
      openTradeCount: open.get(id)?.count || 0,
      closedTradeCount: c?.closed || 0,
      winRatePercent: decided > 0 ? (c.wins / decided) * 100 : null,
    };
  });
}

/** Deletes a profile and every document scoped to it. Rejected for the last remaining profile or the Default one - losing either would silently orphan the app's baseline. Make another profile the default first (setDefaultProfile) to delete this one. */
export async function deleteProfile(profileId) {
  const profile = await Profile.findById(profileId);
  if (!profile) throw new Error("Profile not found");
  if (profile.isDefault) throw new Error("Can't delete the default profile - make another profile the default first");

  const totalProfiles = await Profile.countDocuments({});
  if (totalProfiles <= 1) throw new Error("Can't delete the last remaining profile");

  await Promise.all([
    GlobalSettings.deleteMany({ profileId }),
    ProfileTrader.deleteMany({ profileId }),
    SimPosition.deleteMany({ profileId }),
    PendingExecution.deleteMany({ profileId }),
    DailySnapshot.deleteMany({ profileId }),
    BalanceAdjustment.deleteMany({ profileId }),
    NegativeBalanceEvent.deleteMany({ profileId }),
  ]);
  await Profile.deleteOne({ _id: profileId });
}
