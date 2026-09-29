#!/usr/bin/env node
// Read-only diagnostic - makes zero writes. Prints exactly which MongoDB
// this process would connect to and what it currently sees there.
//
// Run this TWICE, in two different places, and compare the output:
//   1. From wherever PM2 actually runs the daemon (same working directory
//      PM2 uses, so it loads the exact same .env the daemon does):
//        pm2 exec 0 -- node extras/diagnoseProduction.mjs      (or just
//        cd into that directory and run it directly)
//   2. From wherever the Next.js app is built/running (again, same .env).
//
// If the two runs show a DIFFERENT database name/host, or wildly different
// document counts, the daemon and the web app are talking to two different
// databases - that alone explains every symptom of "the UI writes things
// but the daemon never sees them, and the daemon's own logs never show up
// in the UI's Logs page" (each process would be reading/writing its own
// separate database's SystemLog collection, RpcEndpoint collection, etc.).
//
// Uses the exact same .env-loading logic as src/env.js, so what this
// prints is what the real daemon process would actually use - not a guess.

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");

console.log(`Working directory: ${process.cwd()}`);
console.log(`Looking for .env at: ${envPath}`);
console.log(`.env exists here: ${fs.existsSync(envPath)}`);
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("\nMONGODB_URI is not set - this is exactly the kind of gap that would make the daemon fail to start/connect at all.");
  process.exit(1);
}

function redact(u) {
  return u.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:****@");
}

console.log(`\nMONGODB_URI resolved to: ${redact(uri)}`);

await mongoose.connect(uri, { bufferCommands: false });
const db = mongoose.connection.db;
console.log(`Connected. Database name: ${db.databaseName}`);
console.log(`Connected host(s): ${mongoose.connection.host}`);

console.log("\n--- Collection counts ---");
const collections = ["traders", "rpcendpoints", "systemlogs", "systemcommands", "profiles", "profiletraders", "simpositions"];
for (const name of collections) {
  try {
    const count = await db.collection(name).countDocuments();
    console.log(`${name}: ${count}`);
  } catch (err) {
    console.log(`${name}: error (${err.message})`);
  }
}

console.log("\n--- Most recent SystemLog entries (if any) ---");
const recentLogs = await db.collection("systemlogs").find({}).sort({ createdAt: -1 }).limit(5).toArray();
if (recentLogs.length === 0) {
  console.log("(none - if the daemon has genuinely been running against THIS database, this should never be empty for long, since it logs on every connect/disconnect/watch event.)");
} else {
  for (const l of recentLogs) console.log(`${l.createdAt?.toISOString?.() ?? l.createdAt} [${l.category}] ${l.message}`);
}

console.log("\n--- RPC endpoints in this database ---");
const endpoints = await db.collection("rpcendpoints").find({}).toArray();
for (const e of endpoints) {
  console.log(`${e.url} - status: ${e.status} - lastConnectedAt: ${e.lastConnectedAt} - lastDisconnectedAt: ${e.lastDisconnectedAt}`);
}

await mongoose.disconnect();
console.log("\nDone.");
