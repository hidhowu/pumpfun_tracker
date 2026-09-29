#!/usr/bin/env node
// Pulls wallet addresses out of a leaderboard-style JSON export (an object
// with an `entries` array, each entry having a `walletAddress` field - e.g.
// { "entries": [{ "rank": 1, "walletAddress": "...", ... }, ...] }), prints
// them one per line, and writes the same list to a .txt file in extras/.
//
// Usage: node extras/extractWallets.js <path-to-json-file>

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node extras/extractWallets.js <path-to-json-file>");
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), inputPath);
let data;
try {
  data = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
} catch (err) {
  console.error(`Failed to read/parse ${resolvedPath}: ${err.message}`);
  process.exit(1);
}

// Accept either { entries: [...] } or a bare array of entries.
const entries = Array.isArray(data?.entries) ? data.entries : Array.isArray(data) ? data : [];

const addresses = entries.map((entry) => entry.walletAddress).filter((address) => typeof address === "string" && address.length > 0);

if (addresses.length === 0) {
  console.error(`No walletAddress values found in ${path.basename(resolvedPath)} (expected an "entries" array with a "walletAddress" field on each item).`);
  process.exit(1);
}

const lines = addresses.join("\n");
console.log(lines);

const inputBaseName = path.basename(resolvedPath, path.extname(resolvedPath));
const outputPath = path.join(__dirname, `${inputBaseName}-wallets.txt`);
fs.writeFileSync(outputPath, lines + "\n");

console.error(`\n${addresses.length} address(es) extracted from ${path.basename(resolvedPath)} -> written to ${outputPath}`);
