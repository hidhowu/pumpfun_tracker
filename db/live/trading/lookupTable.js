import { AddressLookupTableAccount, AddressLookupTableProgram, ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { LiveWallet } from "../../models/LiveWallet.js";
import { rpc } from "../../onchainPrice.js";
import { logEvent } from "../../systemLog.js";
import { base58Encode } from "../walletKeys.js";

/**
 * The live wallet's address lookup table. A swap that first turns SOL into a quote token touches ~37 accounts, which does not fit one transaction
 * (1232 bytes); an address lookup table owned by the wallet shrinks every known account to one byte. ONE table per wallet serves every token:
 * the accounts all trades share (programs, fee recipients, the SOL pools of USDC / PUMP, ...) go in once, and a trade that still doesn't fit
 * adds the accounts it uses and goes on. It costs about 0.01-0.02 SOL of rent (refundable by closing the table) and a few network fees.
 *
 * The table's address is kept on the LiveWallet. Tables are only ever extended, never shrunk; at 256 addresses a fresh table is started.
 */

const MAX_ADDRESSES = 256;
const EXTEND_CHUNK = 25; // addresses per extend instruction that fit a transaction
const CACHE_MS = 5 * 60_000;
const CONFIRM_WAIT_MS = 45_000;

const cache = new Map(); // table address -> { at, table }
const locks = new Map(); // wallet id -> promise of the growth in progress

/** The wallet's table, or null when it has none (or it can't be read). */
export async function loadWalletTable(live, { fresh = false } = {}) {
  const address = live.lookupTable;
  if (!address) return null;
  const hit = cache.get(address);
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) return hit.table;
  const result = await rpc("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]).catch(() => null);
  if (!result?.value) return hit?.table ?? null;
  const table = new AddressLookupTableAccount({ key: new PublicKey(address), state: AddressLookupTableAccount.deserialize(Buffer.from(result.value.data[0], "base64")) });
  cache.set(address, { at: Date.now(), table });
  return table;
}

async function sendAndConfirm(keypair, instructions) {
  const { value: latest } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
  const tx = new Transaction({ feePayer: keypair.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), ...instructions);
  tx.sign(keypair);
  const signature = base58Encode(tx.signature);
  const raw = tx.serialize().toString("base64");
  const until = Date.now() + CONFIRM_WAIT_MS;
  let lastSend = 0;
  while (Date.now() < until) {
    if (Date.now() - lastSend > 2000) {
      lastSend = Date.now();
      await rpc("sendTransaction", [raw, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]).catch((err) => {
        if (/not a recent slot/i.test(err.message)) throw err;
        if (/simulation failed|custom program error|insufficient/i.test(err.message)) throw err;
      });
    }
    const status = (await rpc("getSignatureStatuses", [[signature], { searchTransactionHistory: false }]).catch(() => null))?.value?.[0];
    if (status?.err) throw new Error(`The lookup table transaction was refused: ${JSON.stringify(status.err)}`);
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return status.slot ?? (await rpc("getSlot", [{ commitment: "confirmed" }]));
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("The lookup table transaction didn't confirm in time.");
}

/** Waits until the chain has moved past `slot`: addresses added in a slot can be used from the next one. */
async function waitPast(slot) {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    if ((await rpc("getSlot", [{ commitment: "confirmed" }]).catch(() => 0)) > slot) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function growUnlocked({ keypair, live, addresses }) {
  const owner = keypair.publicKey;
  const wanted = new Map(addresses.map((a) => [a.toBase58(), a]));
  wanted.delete(owner.toBase58()); // the fee payer signs, so it stays in the message itself
  let table = await loadWalletTable(live, { fresh: true });
  const known = new Set((table?.state.addresses ?? []).map((a) => a.toBase58()));
  const missing = [...wanted.values()].filter((a) => !known.has(a.toBase58()));
  if (!missing.length) return table;

  let address = table ? table.key : null;
  let toAdd = missing;
  if (table && known.size + missing.length > MAX_ADDRESSES) {
    // Full: start a new table with everything this trade uses (the old one stays on the chain; its rent can be reclaimed by closing it).
    address = null;
    toAdd = [...wanted.values()];
    logEvent("tracker", `[live-wallet] "${live.name}": lookup table ${table.key.toBase58()} is full, starting a new one`, { level: "warn", meta: { walletId: String(live._id) } });
  }
  let lastSlot = 0;
  for (let i = 0; i < toAdd.length; i += EXTEND_CHUNK) {
    // Creating a table takes a recent slot, and the RPC's nodes don't always agree on which slots are recent: a fresh slot is taken for each of up to 6 tries.
    for (let attempt = 1; ; attempt++) {
      const ixs = [];
      let creating = null;
      if (!address) {
        const [createIx, created] = AddressLookupTableProgram.createLookupTable({ authority: owner, payer: owner, recentSlot: await rpc("getSlot", [{ commitment: "confirmed" }]) });
        ixs.push(createIx);
        creating = created;
      }
      ixs.push(AddressLookupTableProgram.extendLookupTable({ lookupTable: creating ?? address, authority: owner, payer: owner, addresses: toAdd.slice(i, i + EXTEND_CHUNK) }));
      try {
        lastSlot = await sendAndConfirm(keypair, ixs);
        if (creating) {
          address = creating;
          await LiveWallet.updateOne({ _id: live._id }, { $set: { lookupTable: address.toBase58() } });
          live.lookupTable = address.toBase58();
        }
        break;
      } catch (err) {
        // The RPC reports a stale slot as a plain simulation failure, without the program log that names it, so that counts too.
        if (!creating || attempt >= 6 || !/not a recent slot|simulation failed|invalid instruction data/i.test(String(err.message))) throw err;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  await waitPast(lastSlot);
  cache.delete(address.toBase58());
  const grown = await loadWalletTable({ ...live, lookupTable: address.toBase58() }, { fresh: true });
  logEvent("tracker", `[live-wallet] "${live.name}": lookup table ${address.toBase58()} now holds ${grown?.state.addresses.length ?? "?"} addresses (+${toAdd.length})`, { meta: { walletId: String(live._id) } });
  return grown;
}

/**
 * Makes sure the wallet's table holds `addresses` (creating the table first if the wallet has none) and returns it. One growth per wallet at a time.
 * @param {{ keypair: import("@solana/web3.js").Keypair, live: object, addresses: PublicKey[] }} options
 */
export async function growWalletTable(options) {
  const key = String(options.live._id);
  while (locks.has(key)) await locks.get(key).catch(() => {});
  const work = growUnlocked(options);
  locks.set(key, work);
  try {
    return await work;
  } finally {
    locks.delete(key);
  }
}

// One at a time in the whole process: the builds below pin Math.random for a moment.
let collecting = Promise.resolve();

/**
 * Every account a trade can use. A trade picks some accounts at random (pump.fun's fee recipients, each from a list of 8 or fewer), so the
 * trade is built 10 times with that random choice pinned to 10 different values, which visits every entry of every such list.
 * @param {() => Promise<import("@solana/web3.js").TransactionInstruction[]>} build builds the trade's instructions
 * @returns {Promise<PublicKey[]>}
 */
export function collectTradeAddresses(build) {
  const run = async () => {
    const addresses = new Map();
    const realRandom = Math.random;
    try {
      for (let k = 0; k < 10; k++) {
        Math.random = () => (k + 0.5) / 10;
        for (const ix of await build()) for (const { pubkey } of ix.keys) addresses.set(pubkey.toBase58(), pubkey);
      }
    } finally {
      Math.random = realRandom;
    }
    return [...addresses.values()];
  };
  const next = collecting.then(run, run);
  collecting = next.catch(() => {});
  return next;
}

// ------------------------------------------------------------------ creating the table ahead of the first trade

/**
 * The accounts every pump.fun trade touches, whatever the token: the programs, their global accounts and event authorities. Read from the SDK's own constants.
 * @returns {PublicKey[]}
 */
function sharedAddresses(pump, amm) {
  const keys = [
    pump.PUMP_PROGRAM_ID, pump.PUMP_AMM_PROGRAM_ID, pump.PUMP_FEE_PROGRAM_ID, pump.GLOBAL_PDA, pump.AMM_GLOBAL_PDA, pump.PUMP_EVENT_AUTHORITY_PDA, pump.PUMP_AMM_EVENT_AUTHORITY_PDA,
    pump.PUMP_FEE_CONFIG_PDA, pump.PUMP_FEE_EVENT_AUTHORITY_PDA, pump.FEE_PROGRAM_GLOBAL_PDA, pump.GLOBAL_VOLUME_ACCUMULATOR_PDA, pump.AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA,
    new PublicKey("11111111111111111111111111111111"),
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    new PublicKey("So11111111111111111111111111111111111111112"),
  ];
  return keys.filter((k) => k instanceof PublicKey);
}

/**
 * Creates the wallet's lookup table now (or tops it up) so that its first trade doesn't have to: the accounts all pump.fun trades share, plus
 * every account a buy uses on a handful of sample markets - a token on the bonding curve, a graduated one, and one for each kind of quote token
 * (USDC, PUMP, ...) among `sampleMints`. The fee recipients pump.fun picks at random are all covered. A trade that still needs something else
 * adds it by itself later, as before.
 * @param {{ keypair: import("@solana/web3.js").Keypair, live: object, sampleMints: string[], buildBuy: (mint: string) => Promise<import("@solana/web3.js").TransactionInstruction[]>, resolveKind: (mint: string) => Promise<string | null> }} options
 *   resolveKind says what kind of market a sample is ("curve", "amm", or "quote:<mint>"), null if unusable - one sample per kind is used.
 * @returns {Promise<{ address: string, total: number, added: number, samples: string[] }>}
 */
export async function createWalletTable({ keypair, live, sampleMints, buildBuy, resolveKind, pumpSdks }) {
  const { pump, amm } = pumpSdks();
  const before = (await loadWalletTable(live, { fresh: true }))?.state.addresses.length ?? 0;
  const chosen = new Map(); // kind -> mint
  let next = 0;
  const worker = async () => {
    while (next < sampleMints.length && chosen.size < 6) {
      const mint = sampleMints[next++];
      const kind = await resolveKind(mint).catch(() => null);
      if (kind && !chosen.has(kind)) chosen.set(kind, mint);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const addresses = new Map(sharedAddresses(pump, amm).map((a) => [a.toBase58(), a]));
  let first = true;
  for (const mint of chosen.values()) {
    const found = first ? await collectTradeAddresses(() => buildBuy(mint)) : await buildBuy(mint).then((ixs) => ixs.flatMap((ix) => ix.keys.map((k) => k.pubkey)));
    first = false;
    for (const a of found) addresses.set(a.toBase58(), a);
  }
  const table = await growWalletTable({ keypair, live, addresses: [...addresses.values()] });
  return { address: (table?.key ?? new PublicKey(live.lookupTable)).toBase58(), total: table?.state.addresses.length ?? 0, added: Math.max(0, (table?.state.addresses.length ?? 0) - before), samples: [...chosen.values()] };
}
