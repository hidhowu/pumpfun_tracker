#!/usr/bin/env node
// One-time, idempotent migration for a MongoDB database that predates
// multi-profile support (and possibly predates the multi-RPC work too).
// Safe to run more than once - every step checks "does this already exist"
// or "is this already fixed" before doing anything.
//
// Does two things:
//   1. Introduces multi-profile support: creates a "Default" Profile,
//      copies every Trader.settings/sim (old shape) into a ProfileTrader
//      row under it, backfills profileId onto every existing SimPosition/
//      PendingExecution/DailySnapshot/BalanceAdjustment/NegativeBalanceEvent
//      document, and splits the legacy singleton GlobalSettings into the
//      Default profile's GlobalSettings + the system-wide SystemSettings.
//   2. Drops the old pre-multi-profile unique indexes on PendingExecution/
//      SimPosition/DailySnapshot/GlobalSettings, if they're still present.
//      Mongoose only ADDS indexes it doesn't have - it never drops ones no
//      longer declared in the schema - so a database that's been running
//      since before multi-profile support will still have e.g. a unique
//      index on just (traderAddress, mint, action) for PendingExecution,
//      which silently blocks a SECOND profile from ever queuing a buy/sell
//      for the same trader+mint (it collides with the first profile's row,
//      even though they're in different profiles) - the doc still gets
//      created for the Default profile's queue, but for any newly-added
//      profile the write throws a duplicate-key error, which the app
//      treats as "someone already queued this" and just silently skips it.
//
// Usage:
//   node extras/migrateProduction.mjs "<mongodb-uri>"
//   node extras/migrateProduction.mjs                 # falls back to MONGODB_URI from .env
//
// Prints exactly which URI it's about to touch (password redacted) before
// doing anything, and everything is either idempotent or additive - run it
// against production with confidence, and re-run it any time you're unsure
// whether it already ran.

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env the same way src/env.js does, WITHOUT importing that module -
// importing it would also parse SOLANA_* vars we don't need here, and more
// importantly this script needs to connect to whichever URI is passed on
// the command line, not necessarily whatever .env currently has active.
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const targetUri = process.argv[2] || process.env.MONGODB_URI;
if (!targetUri) {
  console.error("Usage: node extras/migrateProduction.mjs \"<mongodb-uri>\"");
  console.error("(or set MONGODB_URI in your environment/.env before running with no argument)");
  process.exit(1);
}

function redact(uri) {
  return uri.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@");
}

console.log(`Connecting to: ${redact(targetUri)}`);
await mongoose.connect(targetUri, { bufferCommands: false });
console.log("Connected.\n");

// Import models AFTER connecting - they attach to the default mongoose
// connection, and importing db/connect.js would try to connect a SECOND
// time using .env's MONGODB_URI, which isn't necessarily the one we want here.
const { Profile } = await import("../db/models/Profile.js");
const { ProfileTrader } = await import("../db/models/ProfileTrader.js");
const { Trader } = await import("../db/models/Trader.js");
const { GlobalSettings } = await import("../db/models/GlobalSettings.js");
const { SystemSettings } = await import("../db/models/SystemSettings.js");
const { SimPosition } = await import("../db/models/SimPosition.js");
const { PendingExecution } = await import("../db/models/PendingExecution.js");
const { DailySnapshot } = await import("../db/models/DailySnapshot.js");
const { BalanceAdjustment } = await import("../db/models/BalanceAdjustment.js");
const { NegativeBalanceEvent } = await import("../db/models/NegativeBalanceEvent.js");

console.log("=== Part 1: multi-profile migration ===\n");

// 1. Default profile.
let defaultProfile = await Profile.findOne({ isDefault: true });
if (!defaultProfile) {
  defaultProfile = await Profile.create({ name: "Default", isDefault: true });
  console.log("Created Default profile:", defaultProfile._id.toString());
} else {
  console.log("Default profile already exists:", defaultProfile._id.toString());
}
const defaultId = defaultProfile._id;

// 2. Trader.settings/sim -> ProfileTrader, one per existing trader, skip if already migrated.
const traders = await Trader.collection.find({}).toArray(); // raw driver - current schema no longer declares settings/sim, but they're still physically stored on old documents
let createdCount = 0;
let skippedCount = 0;
for (const trader of traders) {
  const existing = await ProfileTrader.findOne({ profileId: defaultId, traderAddress: trader.address });
  if (existing) {
    skippedCount += 1;
    continue;
  }
  await ProfileTrader.create({
    profileId: defaultId,
    traderAddress: trader.address,
    settings: trader.settings || {},
    sim: trader.sim || {},
  });
  createdCount += 1;
}
console.log(`ProfileTrader: created ${createdCount}, already existed ${skippedCount} (of ${traders.length} traders)`);

// 3. Backfill profileId on every profile-scoped collection missing it.
for (const [name, Model] of [
  ["SimPosition", SimPosition],
  ["PendingExecution", PendingExecution],
  ["DailySnapshot", DailySnapshot],
  ["BalanceAdjustment", BalanceAdjustment],
  ["NegativeBalanceEvent", NegativeBalanceEvent],
]) {
  const res = await Model.updateMany({ profileId: { $exists: false } }, { $set: { profileId: defaultId } });
  console.log(`${name}: backfilled profileId on ${res.modifiedCount} document(s)`);
}

// 4. Split the legacy singleton GlobalSettings{key:"global"} into
//    SystemSettings (defaultMuted/riskCheckIntervalSeconds - system-wide)
//    and the Default profile's GlobalSettings (everything else).
const legacy = await GlobalSettings.collection.findOne({ key: "global" });
if (legacy) {
  const existingSystemSettings = await SystemSettings.findOne({ key: "system" });
  if (!existingSystemSettings) {
    await SystemSettings.create({
      key: "system",
      defaultMuted: legacy.defaultMuted ?? false,
      riskCheckIntervalSeconds: legacy.riskCheckIntervalSeconds ?? 20,
    });
    console.log("Created SystemSettings from legacy GlobalSettings values");
  } else {
    console.log("SystemSettings already exists, left untouched");
  }

  if (!legacy.profileId) {
    await GlobalSettings.collection.updateOne({ _id: legacy._id }, { $set: { profileId: defaultId } });
    console.log("Tagged legacy GlobalSettings document with the Default profile's id");
  } else {
    console.log("Legacy GlobalSettings document already has a profileId - left untouched");
  }
} else {
  console.log("No legacy GlobalSettings singleton found - nothing to split");
  await GlobalSettings.findOneAndUpdate({ profileId: defaultId }, {}, { upsert: true });
  const sys = await SystemSettings.findOne({ key: "system" });
  if (!sys) await SystemSettings.create({ key: "system" });
}

console.log("\n=== Part 2: drop stale pre-multi-profile indexes ===\n");

async function dropIfExists(Model, name) {
  try {
    await Model.collection.dropIndex(name);
    console.log(`Dropped ${Model.modelName}.${name}`);
  } catch (err) {
    console.log(`Skip ${Model.modelName}.${name}: ${err.message}`);
  }
}

await dropIfExists(PendingExecution, "traderAddress_1_mint_1_action_1");
await dropIfExists(SimPosition, "traderAddress_1_mint_1");
await dropIfExists(DailySnapshot, "traderAddress_1_date_1");
await dropIfExists(GlobalSettings, "key_1");

console.log("\n=== Verification ===\n");
console.log("PendingExecution indexes:", (await PendingExecution.collection.indexes()).map((i) => i.name));
console.log("SimPosition indexes:", (await SimPosition.collection.indexes()).map((i) => i.name));
console.log("DailySnapshot indexes:", (await DailySnapshot.collection.indexes()).map((i) => i.name));
console.log("GlobalSettings indexes:", (await GlobalSettings.collection.indexes()).map((i) => i.name));

console.log("\nMigration complete.");
await mongoose.disconnect();
