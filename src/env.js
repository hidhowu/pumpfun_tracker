import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");

if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

function splitList(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const rpcUrls = splitList(process.env.SOLANA_RPC_URLS);
const wsUrls = splitList(process.env.SOLANA_WS_URLS);

export const config = {
  rpcUrls: rpcUrls.length ? rpcUrls : ["https://api.mainnet-beta.solana.com"],
  wsUrls,
  trackedAddresses: splitList(process.env.TRACKED_ADDRESSES),
  // "processed" is the fastest path (unconfirmed); "confirmed" is a good
  // middle ground; never use "finalized" for live tracking, it lags ~13s+.
  commitment: process.env.SOLANA_COMMITMENT || "processed",
};
