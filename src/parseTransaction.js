#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProgramInfo, WELL_KNOWN_PROGRAM_NAMES } from "./idlRegistry.js";
import { extractProgramDataEvents } from "./logStack.js";
import { RpcPool } from "./rpcPool.js";
import { config } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
// Every mint that represents "currency" rather than a real pump.fun token -
// a pump.fun-amm pool can be quoted in any of these (not just SOL), and
// occasionally a pool's base/quote sides are BOTH one of these (e.g. a
// USDC<->USDT or SOL<->USDC swap that happens to route through a pump.fun-amm
// pool) - see isKnownCurrencyMint below for how this is used.
const KNOWN_CURRENCY_MINTS = new Set([SYSTEM_PROGRAM_ID, WSOL_MINT, USDC_MINT, USDT_MINT]);

function isKnownCurrencyMint(mint) {
  return !!mint && KNOWN_CURRENCY_MINTS.has(mint);
}

function usage() {
  console.log(
    `Usage: node src/parseTransaction.js <signature> [<signature> ...] [--rpc <url>] [--out-dir <dir>] [--quiet]\n\n` +
      `Env: SOLANA_RPC_URLS (comma-separated) can be set in .env instead of --rpc.`
  );
}

function parseArgs(argv) {
  const args = { signatures: [], rpc: null, outDir: path.join(__dirname, "..", "output"), quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rpc") args.rpc = argv[++i];
    else if (a === "--out-dir") args.outDir = argv[++i];
    else if (a === "--quiet") args.quiet = true;
    else if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    } else args.signatures.push(a);
  }
  return args;
}

/**
 * Fetches + decodes a transaction, retrying on a null result.
 *
 * Root cause of "only one of several trades gets detected": logsSubscribe
 * fires at "processed" commitment (near-instant), but getTransaction here
 * was being called with NO commitment param, which defaults to
 * "finalized" - and finalization takes ~13-30s+ on mainnet. Different RPC
 * nodes in the pool also don't all catch up at the same instant. The old
 * code threw immediately on a null result with zero retry, so any trade
 * whose getTransaction call landed before that node had it available was
 * silently dropped. Fix: request "confirmed" (the fastest level
 * getTransaction actually supports) and retry with backoff to bridge the
 * gap between the WS notification and the transaction being fetchable.
 */
async function fetchTransaction(rpcPool, signature, { maxAttempts = 8, baseDelayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
    try {
      const result = await rpcPool.call("getTransaction", [
        signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" },
      ]);
      if (result) return result;
      lastError = new Error("Transaction not found (null result)");
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `${signature}: transaction still not fetchable after ${maxAttempts} attempts - ${lastError?.message || "unknown error"}`
  );
}

// --- generic value normalization (BN -> string, PublicKey -> base58, Buffer -> hex) ---
function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (typeof value === "object") {
    if (typeof value.toBase58 === "function") return value.toBase58();
    if (value.constructor && value.constructor.name === "BN") return value.toString();
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

// --- flatten top-level + inner instructions into one ordered list ---
function flattenInstructions(tx) {
  const top = tx.transaction.message.instructions;
  const innerGroups = new Map((tx.meta.innerInstructions || []).map((g) => [g.index, g.instructions]));
  const flat = [];
  top.forEach((ix, i) => {
    flat.push({ index: `${i}`, topLevelIndex: i, depth: 1, ix });
    const inner = innerGroups.get(i) || [];
    inner.forEach((innerIx, j) => {
      const depth = typeof innerIx.stackHeight === "number" ? innerIx.stackHeight : 2;
      flat.push({ index: `${i}.${j}`, topLevelIndex: i, depth, ix: innerIx });
    });
  });
  return flat;
}

function decodeInstruction(ix) {
  const programId = ix.programId;
  if (ix.parsed) {
    return {
      programId,
      program: ix.program || WELL_KNOWN_PROGRAM_NAMES[programId] || "unknown",
      source: "rpc-parsed",
      type: ix.parsed.type || "unknown",
      info: toPlain(ix.parsed.info),
    };
  }
  const programInfo = getProgramInfo(programId);
  if (programInfo && ix.data) {
    try {
      const decoded = programInfo.instructionCoder.decode(ix.data, "base58");
      if (decoded) {
        const idlIx = programInfo.idl.instructions.find((i) => i.name === decoded.name);
        const accountNames = (idlIx?.accounts || []).map((a) => a.name);
        const accounts = {};
        (ix.accounts || []).forEach((pubkey, idx) => {
          accounts[accountNames[idx] || `account_${idx}`] = pubkey;
        });
        return {
          programId,
          program: programInfo.label,
          source: "anchor-idl",
          type: decoded.name,
          args: toPlain(decoded.data),
          accounts,
        };
      }
    } catch {
      // fall through to raw below
    }
  }
  return {
    programId,
    program: WELL_KNOWN_PROGRAM_NAMES[programId] || "unknown",
    source: "raw",
    accounts: ix.accounts || [],
    dataBase58: ix.data || null,
  };
}

function decodeProgramDataEvents(tx) {
  const rawEvents = extractProgramDataEvents(tx.meta.logMessages);
  return rawEvents
    .map(({ programId, dataBase64, depth, topLevelIndex }) => {
      const programInfo = getProgramInfo(programId);
      if (!programInfo || !programInfo.eventCoder) return null;
      const decoded = programInfo.eventCoder.decode(dataBase64);
      if (!decoded) return null;
      return {
        programId,
        program: programInfo.label,
        depth,
        topLevelIndex,
        name: decoded.name,
        data: toPlain(decoded.data),
      };
    })
    .filter(Boolean);
}

function computeSolChanges(tx) {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const pre = tx.meta.preBalances;
  const post = tx.meta.postBalances;
  const changes = [];
  keys.forEach((pubkey, i) => {
    const delta = post[i] - pre[i];
    if (delta !== 0) {
      changes.push({
        account: pubkey,
        preLamports: pre[i],
        postLamports: post[i],
        deltaLamports: delta,
        deltaSol: delta / LAMPORTS_PER_SOL,
      });
    }
  });
  return changes.sort((a, b) => a.deltaLamports - b.deltaLamports);
}

function computeTokenChanges(tx) {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const pre = tx.meta.preTokenBalances || [];
  const post = tx.meta.postTokenBalances || [];
  const byKey = new Map();
  const keyFor = (b) => `${b.accountIndex}:${b.mint}`;
  for (const b of pre) byKey.set(keyFor(b), { pre: b, post: null });
  for (const b of post) {
    const k = keyFor(b);
    const existing = byKey.get(k);
    if (existing) existing.post = b;
    else byKey.set(k, { pre: null, post: b });
  }
  const changes = [];
  for (const { pre: preB, post: postB } of byKey.values()) {
    const base = postB || preB;
    const decimals = base.uiTokenAmount.decimals;
    const preAmount = preB ? BigInt(preB.uiTokenAmount.amount) : 0n;
    const postAmount = postB ? BigInt(postB.uiTokenAmount.amount) : 0n;
    const delta = postAmount - preAmount;
    if (delta !== 0n) {
      changes.push({
        account: keys[base.accountIndex],
        owner: base.owner || null,
        mint: base.mint,
        decimals,
        preAmount: preAmount.toString(),
        postAmount: postAmount.toString(),
        deltaAmount: delta.toString(),
        deltaUi: Number(delta) / 10 ** decimals,
      });
    }
  }
  return changes;
}

function findMintDecimals(tx, mint, fallback = 6) {
  const all = [...(tx.meta.preTokenBalances || []), ...(tx.meta.postTokenBalances || [])];
  const match = all.find((b) => b.mint === mint);
  return match ? match.uiTokenAmount.decimals : fallback;
}

/**
 * Resolves a token account address to its mint via the transaction's own
 * balance changes. This is how pump.fun-amm BuyEvent/SellEvent resolve
 * base_mint/quote_mint - NOT by decoding the triggering instruction's
 * accounts, because that instruction can legitimately fail to decode (e.g.
 * a router like Jupiter invoking an instruction variant, or an on-chain
 * program upgrade, whose byte layout doesn't match our IDL snapshot exactly
 * - seen in practice: a `buy_exact_quote_in` call 16 bytes shorter than our
 * IDL's `track_volume` field expects). The event itself always carries the
 * exact token account address (`user_base_token_account`), and that account
 * unavoidably shows a balance delta in this same transaction - so resolving
 * the mint from balance changes works regardless of whether the
 * instruction itself decoded.
 */
function resolveMintFromTokenAccount(tokenChanges, accountAddress) {
  if (!accountAddress) return null;
  return tokenChanges.find((t) => t.account === accountAddress)?.mint || null;
}

// Find the decoded instruction (by anchor-idl name) that produced a given
// program-data event, so we can pull instruction-only accounts (e.g. the
// pump-amm base_mint/quote_mint, which never appear in the event itself).
function findMatchingInstruction(decodedInstructions, topLevelIndex, program, names) {
  return decodedInstructions.find(
    (i) => i.topLevelIndex === topLevelIndex && i.program === program && i.source === "anchor-idl" && names.includes(i.type)
  );
}

// --- build the human-readable "summary.events" list ---
function buildSummaryEvents(tx, flatInstructions, programEvents, decodedInstructions, tokenChanges) {
  const events = [];

  for (const ev of programEvents) {
    if (ev.name === "TradeEvent") {
      const d = ev.data;
      const decimals = findMintDecimals(tx, d.mint, 6);
      const isNativeSolQuote = !d.quote_mint || d.quote_mint === SYSTEM_PROGRAM_ID;
      events.push({
        order: ev.topLevelIndex,
        type: d.is_buy ? "buy" : "sell",
        program: ev.program,
        wallet: d.user,
        mint: d.mint,
        quoteMint: d.quote_mint || SYSTEM_PROGRAM_ID,
        isNativeSolQuote,
        solAmount: isNativeSolQuote ? Number(d.sol_amount) / LAMPORTS_PER_SOL : null,
        tokenAmount: Number(d.token_amount) / 10 ** decimals,
        feeSol: Number(d.fee || 0) / LAMPORTS_PER_SOL,
        creator: d.creator || null,
        creatorFeeSol: Number(d.creator_fee || 0) / LAMPORTS_PER_SOL,
        feeRecipient: d.fee_recipient || null,
        source: "event:TradeEvent",
        raw: d,
      });
    } else if (ev.name === "BuyEvent" || ev.name === "SellEvent") {
      const d = ev.data;
      const isBuy = ev.name === "BuyEvent";
      // Prefer resolving via the event's own token accounts + this tx's
      // balance changes (robust to the triggering instruction failing to
      // decode); fall back to the decoded instruction's accounts if that
      // somehow comes up empty.
      const matchIx = findMatchingInstruction(decodedInstructions, ev.topLevelIndex, "pump.fun-amm", ["buy", "buy_exact_quote_in", "sell"]);
      const baseMint =
        resolveMintFromTokenAccount(tokenChanges, d.user_base_token_account) || matchIx?.accounts?.base_mint || null;
      const resolvedQuoteMint =
        resolveMintFromTokenAccount(tokenChanges, d.user_quote_token_account) || matchIx?.accounts?.quote_mint || null;
      const baseAmountRaw = isBuy ? (d.base_amount_out ?? null) : (d.base_amount_in ?? null);
      // Bug fix: a SellEvent has no *_in field for the quote side (only
      // quote_amount_out/user_quote_amount_out) - this used to always read
      // quote_amount_in, which doesn't exist on a sell, so solAmount was
      // silently null for every pump.fun-amm sell.
      const quoteAmountRaw = isBuy
        ? (d.quote_amount_in ?? d.user_quote_amount_in ?? null)
        : (d.quote_amount_out ?? d.user_quote_amount_out ?? null);

      // A pump.fun-amm pool isn't necessarily quoted in SOL - it can be
      // quoted in USDC/USDT too, AND the "base"/"quote" labeling isn't
      // guaranteed to put the real token on the base side. Two things to
      // handle, per pool composition:
      //  1. Both sides are known currencies (SOL/USDC/USDT, in any
      //     combination) - this isn't a real pump.fun token trade at all,
      //     just a currency swap that happened to route through a
      //     pump.fun-amm pool. Skip it entirely - we don't copy-trade SOL/
      //     USDC/USDT against each other.
      //  2. The base side is a known currency but the quote side isn't -
      //     labeling is inverted for our purposes; the REAL token is on the
      //     quote side, and the currency actually spent/received is the
      //     base side. Swap which side we treat as "the mint".
      const baseIsCurrency = isKnownCurrencyMint(baseMint);
      const quoteIsCurrency = isKnownCurrencyMint(resolvedQuoteMint);
      if (baseIsCurrency && quoteIsCurrency) continue; // pure currency-to-currency swap - not a token trade, ignore

      const mint = baseIsCurrency ? resolvedQuoteMint : baseMint;
      const quoteMint = baseIsCurrency ? baseMint : resolvedQuoteMint;
      const tokenAmountRaw = baseIsCurrency ? quoteAmountRaw : baseAmountRaw;
      const currencyAmountRaw = baseIsCurrency ? baseAmountRaw : quoteAmountRaw;

      const decimals = findMintDecimals(tx, mint, 6);
      const isNativeSolQuote = quoteMint === WSOL_MINT;
      events.push({
        order: ev.topLevelIndex,
        type: isBuy ? "buy" : "sell",
        program: ev.program,
        wallet: d.user,
        mint,
        quoteMint,
        isNativeSolQuote,
        solAmount: isNativeSolQuote && currencyAmountRaw !== null ? Number(currencyAmountRaw) / LAMPORTS_PER_SOL : null,
        tokenAmount: tokenAmountRaw !== null ? Number(tokenAmountRaw) / 10 ** decimals : null,
        pool: d.pool || null,
        source: `event:${ev.name}`,
        raw: d,
      });
    } else if (ev.name === "CreateEvent") {
      const d = ev.data;
      events.push({
        order: ev.topLevelIndex,
        type: "create",
        program: ev.program,
        wallet: d.user,
        mint: d.mint,
        creator: d.creator,
        bondingCurve: d.bonding_curve,
        name: d.name,
        symbol: d.symbol,
        uri: d.uri,
        source: "event:CreateEvent",
        raw: d,
      });
    } else if (ev.name === "CreatePoolEvent") {
      const d = ev.data;
      events.push({
        order: ev.topLevelIndex,
        type: "create_pool",
        program: ev.program,
        wallet: d.creator || d.user || null,
        mint: d.base_mint || null,
        pool: d.pool || null,
        source: "event:CreatePoolEvent",
        raw: d,
      });
    }
  }

  // Plain, top-level (non-nested) SOL/SPL transfers that are not just the
  // internal plumbing of a buy/sell/create CPI call above.
  for (const { ix, depth, topLevelIndex } of flatInstructions) {
    if (depth !== 1) continue;
    if (!ix.parsed) continue;
    const t = ix.parsed.type;
    if (!["transfer", "transferChecked"].includes(t)) continue;
    const info = ix.parsed.info;
    let amount = null;
    if (ix.program === "system") {
      amount = typeof info.lamports === "number" ? info.lamports / LAMPORTS_PER_SOL : null;
    } else if (info.tokenAmount) {
      amount = Number(info.tokenAmount.uiAmountString ?? info.tokenAmount.uiAmount);
    } else if (info.amount !== undefined) {
      amount = info.amount; // raw base-unit string, decimals unknown for unchecked spl-token transfer
    }
    events.push({
      order: topLevelIndex,
      type: "transfer",
      program: ix.program,
      wallet: info.authority || info.source || null,
      from: info.source || info.authority || null,
      to: info.destination || null,
      mint: info.mint || "SOL",
      amount,
      source: "instruction:" + t,
      raw: toPlain(info),
    });
  }

  events.sort((a, b) => a.order - b.order);
  return events;
}

function classifyTransaction(summaryEvents) {
  const types = [...new Set(summaryEvents.map((e) => e.type))];
  if (types.length === 0) return "other";
  if (types.length === 1) return types[0];
  return "multi:" + types.join("+");
}

/**
 * Fetches and fully decodes a Solana transaction signature.
 * @param {string} signature
 * @param {RpcPool} rpcPool
 * @returns {Promise<{signature: string, summary: object, parsedTransaction: object}>}
 */
export async function parseTransaction(signature, rpcPool) {
  const tx = await fetchTransaction(rpcPool, signature);

  const message = tx.transaction.message;
  const accountKeys = message.accountKeys.map((k) => ({
    pubkey: k.pubkey,
    signer: !!k.signer,
    writable: !!k.writable,
    source: k.source || "static",
  }));
  const feePayer = accountKeys[0]?.pubkey || null;
  const signers = accountKeys.filter((a) => a.signer).map((a) => a.pubkey);

  const flat = flattenInstructions(tx);
  const decodedInstructions = flat.map(({ index, depth, topLevelIndex, ix }) => ({
    index,
    depth,
    topLevelIndex,
    ...decodeInstruction(ix),
  }));

  const programEvents = decodeProgramDataEvents(tx);
  const solChanges = computeSolChanges(tx);
  const tokenChanges = computeTokenChanges(tx);
  const summaryEvents = buildSummaryEvents(tx, flat, programEvents, decodedInstructions, tokenChanges);

  const programsInvoked = [...new Set(decodedInstructions.map((i) => i.program))];

  const summary = {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    blockTimeIso: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    success: tx.meta.err === null,
    error: tx.meta.err,
    feeLamports: tx.meta.fee,
    feeSol: tx.meta.fee / LAMPORTS_PER_SOL,
    feePayer,
    signers,
    programsInvoked,
    transactionType: classifyTransaction(summaryEvents),
    events: summaryEvents,
    solBalanceChanges: solChanges,
    tokenBalanceChanges: tokenChanges,
  };

  const parsedTransaction = {
    signature,
    slot: tx.slot,
    version: tx.version,
    blockTime: tx.blockTime,
    accountKeys,
    instructions: decodedInstructions,
    programDataEvents: programEvents,
    logMessages: tx.meta.logMessages || [],
    computeUnitsConsumed: tx.meta.computeUnitsConsumed ?? null,
    fee: tx.meta.fee,
    status: tx.meta.err === null ? "success" : "failed",
    error: tx.meta.err,
  };

  return { signature, summary, parsedTransaction };
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.signatures.length === 0) {
    usage();
    process.exit(1);
  }
  fs.mkdirSync(args.outDir, { recursive: true });

  const rpcPool = new RpcPool(args.rpc ? [args.rpc] : config.rpcUrls);

  const results = [];
  for (const signature of args.signatures) {
    try {
      const result = await parseTransaction(signature, rpcPool);
      results.push(result);
      const outFile = path.join(args.outDir, `${signature}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
      if (!args.quiet) {
        console.log(`\n=== ${signature} ===`);
        console.log(`type: ${result.summary.transactionType}  slot: ${result.summary.slot}  success: ${result.summary.success}`);
        console.log(`feePayer: ${result.summary.feePayer}`);
        for (const e of result.summary.events) {
          console.log(`  [${e.type}] wallet=${e.wallet}  mint=${e.mint}  sol=${e.solAmount ?? e.amount ?? "-"}  tokens=${e.tokenAmount ?? "-"}`);
        }
        console.log(`written -> ${outFile}`);
      }
    } catch (err) {
      console.error(`Failed to parse ${signature}: ${err.message}`);
    }
  }

  if (args.signatures.length > 1) {
    const outFile = path.join(args.outDir, "batch.json");
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli();
}
