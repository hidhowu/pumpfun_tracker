import { PublicKey, SystemProgram } from "@solana/web3.js";

/**
 * Sending a transaction through Jito's block engine (https://docs.jito.wtf/lowlatencytxnsend/).
 *
 * A transaction goes out as a ONE-TRANSACTION BUNDLE (sendBundle): the tip is a plain SOL transfer to one of Jito's tip accounts inside
 * the same transaction, and with a bundle only the tip matters (no priority fee on top). A bundle lands completely or not at all,
 * so a trade that would fail on the chain (price moved past the slippage limit, ...) costs neither its fee nor its tip.
 *
 * Jito allows about one request per second per IP per region without a key, so sends rotate over the regional block engines and
 * fail over to the next on a 429 or a timeout. The SAME signed transaction can be offered to several regions: it can only ever land once
 * (one signature), so offering it again while waiting can never double-trade.
 */

// Constant, from getTipAccounts. A tip must go to one of these; picking one at random spreads the contention.
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

export const MIN_TIP_LAMPORTS = 1000; // Jito's minimum for a bundle

const DEFAULT_ENGINES = [
  "https://mainnet.block-engine.jito.wtf",
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://london.mainnet.block-engine.jito.wtf",
  "https://tokyo.mainnet.block-engine.jito.wtf",
  "https://singapore.mainnet.block-engine.jito.wtf",
  "https://slc.mainnet.block-engine.jito.wtf",
  "https://dublin.mainnet.block-engine.jito.wtf",
];
const REQUEST_TIMEOUT_MS = 4000;

/** Block engines to use: JITO_BLOCK_ENGINES (comma-separated, in order of preference) or all nine public ones. */
export function blockEngines() {
  const fromEnv = (process.env.JITO_BLOCK_ENGINES || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ENGINES;
}

let rotation = 0;

/** Engines in the order to try them: starting from where the last send stopped, so consecutive sends use different regions. */
function engineOrder() {
  const engines = blockEngines();
  const start = rotation++ % engines.length;
  return [...engines.slice(start), ...engines.slice(0, start)];
}

export class JitoError extends Error {
  constructor(message, { rateLimited = false } = {}) {
    super(message);
    this.rateLimited = rateLimited;
  }
}

export function randomTipAccount() {
  return new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
}

/** The tip: a SOL transfer to a Jito tip account. Put it LAST in the transaction, next to the swap it pays for. */
export function tipInstruction(from, lamports) {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: randomTipAccount(), lamports: BigInt(Math.max(MIN_TIP_LAMPORTS, Math.floor(Number(lamports)))) });
}

/** Lamports for a USD tip at the current SOL price (never below Jito's minimum). */
export function usdToTipLamports(usd, solUsd) {
  if (!(solUsd > 0)) throw new JitoError("The SOL price isn't available, so the Jito fee can't be worked out.");
  return Math.max(MIN_TIP_LAMPORTS, Math.round((Math.max(0, usd) / solUsd) * 1e9));
}

async function post(engine, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.JITO_AUTH_UUID) headers["x-jito-auth"] = process.env.JITO_AUTH_UUID;
  let res;
  try {
    res = await fetch(`${engine}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new JitoError(`${engine}: ${err instanceof Error ? err.message : "no answer"}`);
  }
  if (res.status === 429) throw new JitoError(`${engine}: rate limited`, { rateLimited: true });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) throw new JitoError(`${engine}: ${json?.error?.message ?? `HTTP ${res.status}`}`);
  return json?.result;
}

/**
 * Offers one signed transaction (base64) to Jito as a single-transaction bundle. Tries the regions one after another until one accepts it.
 * @returns {Promise<{ bundleId: string, engine: string }>}
 */
export async function sendBundle(signedBase64) {
  let last;
  for (const engine of engineOrder()) {
    try {
      const bundleId = await post(engine, "/api/v1/bundles", { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[signedBase64], { encoding: "base64" }] });
      return { bundleId, engine };
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new JitoError("No block engine answered.");
}

/** Where a bundle is in Jito's system (last 5 minutes): "Pending" | "Landed" | "Failed" | "Invalid", or null if it can't be asked. */
export async function inflightStatus(bundleId) {
  for (const engine of engineOrder().slice(0, 2)) {
    try {
      const result = await post(engine, "/api/v1/getInflightBundleStatuses", { jsonrpc: "2.0", id: 1, method: "getInflightBundleStatuses", params: [[bundleId]] });
      return result?.value?.[0]?.status ?? null;
    } catch {
      // try the next
    }
  }
  return null;
}
