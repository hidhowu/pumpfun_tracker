import mongoose from "mongoose";
import { Keypair, PublicKey } from "@solana/web3.js";
import { LiveWallet } from "../../models/LiveWallet.js";
import { LiveLot } from "../../models/LiveLot.js";
import { LiveExecution } from "../../models/LiveExecution.js";
import { Wallet } from "../../models/Wallet.js";
import { getSolUsd, rpc } from "../../onchainPrice.js";
import { logEvent } from "../../systemLog.js";
import { failOrRetry, reapStale, savePlan } from "../../simulation/atomic.js";
import { isTradingPaused } from "../../simulation/guards.js";
import { base58Decode, base58Encode, decryptWalletSecret } from "../walletKeys.js";
import { invalidateChainSnapshot } from "../chain.js";
import { prepareBuy, prepareSell, TradeError } from "./pumpSwap.js";
import { WSOL_MINT } from "./market.js";
import { usdToTipLamports } from "./jito.js";
import { SendError, buildSignedTrade, fitsTransaction, landTrade } from "./liveTx.js";
import { OutcomeError, readTradeOutcome } from "./outcome.js";
import { oneToken, settle, swapPriceUsd } from "./lots.js";
import { assumedJitoFeeUsd, tradingSettings, networkFeeLamports, BASE_FEE_LAMPORTS } from "./settings.js";
import { collectTradeAddresses, growWalletTable, loadWalletTable } from "./lookupTable.js";
import { recordTx } from "./txStats.js";
import { flagSellFailure } from "./alerts.js";
import { dryStyleIds, lotStyleIds, selectedStyleId } from "./styles.js";
import { findUnpaired } from "./pairing.js";

/**
 * The live wallets' trade queue worker: takes what db/live/trading/mirror.js queued and turns it into real trades (or, in a dry run, into the trades the
 * chain's own numbers say would have happened). Nothing waits: an entry is due the moment it is queued - the simulated execution delay does not apply.
 *
 * Money safety, in order of importance:
 *  1. A trade's signed transaction is stored on the queue entry BEFORE it is sent. Whatever dies afterwards (this process, the network, the
 *     answer), the next run looks that signature up on the chain first and only offers the same transaction again - it can land once at most.
 *     A new transaction is built only after the old one has expired for good.
 *  2. What a trade cost or paid is read back from the confirmed transaction (db/live/trading/outcome.js), never taken from the quote.
 *  3. A sell only ever sells ITS lot's tokens (minus one token, left behind on purpose), and never more than the account really holds.
 */

const LIVE_LEASE_MS = 240_000; // longer than the slowest landing (about 100 s) plus reading the result back
const TOKEN_ACCOUNT_RENT_ESTIMATE = 2_100_000; // what opening a token account holds (a bit above the usual 0.00204 SOL)
const BATCH = 8;
const MAX_WAIT_FOR_BUY_MS = 60_000;
// A failed trade is retried quickly, or not at all: a buy more than this long after the trader's is no longer the trade the simulation took
// (the wallet's own wait before building, tradeDelaySeconds, is not counted).
const MAX_BUY_AGE_MS = 45_000;
// Retries after the first try. A buy gives up sooner than a sell: a position left open without an exit is the worse of the two.
const RETRIES = { buy: 3, sell: 10 };
const retryDelayMs = { buy: (attempt) => 400 * attempt, sell: (attempt) => Math.min(15_000, 1000 * attempt) };
// The price of paying with SOL, headroom on top of the budget (the pool route can cost a little over it).
const PAY_WITH_SOL_HEADROOM = 1.03;

const lamportsToSol = (lamports) => lamports / 1e9;

class Skip extends Error {}

async function markSkipped(item, reason) {
  await LiveExecution.updateOne({ _id: item._id }, { $set: { status: "skipped", skipReason: reason, processedAt: new Date(), leaseUntil: null } });
  logEvent("trade", `[live] Skipped ${item.action} of ${item.mint} for ${item.traderAddress}: ${reason}`, {
    level: "warn",
    meta: { liveWalletId: String(item.liveWalletId), traderAddress: item.traderAddress, mint: item.mint, action: item.action, reason },
  });
}

async function markDone(item) {
  await LiveExecution.updateOne({ _id: item._id }, { $set: { status: "done", processedAt: new Date(), leaseUntil: null } });
}

/** Writes keys into the stored plan (and the in-memory copy). */
async function setFill(item, patch) {
  const $set = Object.fromEntries(Object.entries(patch).map(([key, value]) => [`fill.${key}`, value]));
  await LiveExecution.updateOne({ _id: item._id }, { $set });
  item.fill = { ...(item.fill ?? {}), ...patch };
}

/** Puts a sell back in the queue a moment later (its buy hasn't finished yet). */
async function later(item, seconds) {
  await LiveExecution.updateOne({ _id: item._id }, { $set: { status: "pending", triggerAt: new Date(Date.now() + seconds * 1000), leaseUntil: null }, $inc: { attempts: 1 } });
}

/** Decrypts the wallet's key for the length of `use` only, and wipes it afterwards. */
async function withKeypair(live, work) {
  const secret = base58Decode(decryptWalletSecret(live.address, live.encryptedSecret));
  try {
    if (secret.length !== 64 || base58Encode(secret.subarray(32)) !== live.address) throw new Error("The stored key doesn't match the live wallet.");
    return await work(Keypair.fromSecretKey(Uint8Array.from(secret)));
  } finally {
    secret.fill(0);
  }
}

async function solBalance(address) {
  return (await rpc("getBalance", [address, { commitment: "confirmed" }])).value;
}

// ------------------------------------------------------------------ building and landing

/** What a trade failure is called in the stats and the stored skip reason: our own messages are safe to keep, anything else is not. */
const safeReason = (err) => (err instanceof Skip || err instanceof SendError || err instanceof TradeError || err instanceof OutcomeError ? err.message : "an unexpected error (see the log)");

/**
 * Builds and signs one trade: the swap's instructions, sized to fit one transaction. A swap that doesn't fit (paying with SOL, token-quoted
 * markets) puts every account it can use into the wallet's lookup table - creating the table the first time - and is built again.
 * @param {(context: { fitTables: Function }) => Promise<object>} prepare builds the swap (prepareBuy / prepareSell with this trade's numbers). A sale made of several
 *   swaps (db/live/trading/sellChain.js) uses `fitTables` to check, before simulating, that a run of swaps fits one transaction. Only a single swap that doesn't fit
 *   grows the lookup table (it takes seconds and costs rent); a longer run that doesn't fit is split instead, so the sale of the token itself never waits for that.
 */
async function buildLiveTx({ live, keypair, fill, prepare }) {
  const startedAt = Date.now();
  const fitTables = async (instructions, rebuild, extra = [], { mayGrow = true } = {}) => {
    const withTable = (table) => [...extra, ...(table ? [table] : [])];
    const fits = (table) => fitsTransaction({ payer: keypair.publicKey, instructions, lookupTables: withTable(table), sendMode: fill.sendMode });
    let table = await loadWalletTable(live);
    if (fits(table)) return withTable(table);
    if (!mayGrow) throw new TradeError("it doesn't fit one transaction with the wallet's lookup table as it is", "too_big");
    table = await growWalletTable({ keypair, live, addresses: await collectTradeAddresses(rebuild) });
    if (!fits(table)) throw new TradeError("it doesn't fit one transaction, even with the wallet's lookup table", "too_big");
    return withTable(table);
  };
  const prepared = await prepare({ fitTables });
  const sign = (table) =>
    buildSignedTrade({
      keypair,
      instructions: prepared.instructions,
      sendMode: fill.sendMode,
      tipLamports: fill.tipLamports,
      priorityMicroLamports: fill.priorityMicroLamports,
      computeUnits: prepared.computeUnits,
      lookupTables: [...prepared.lookupTables, ...(table ? [table] : [])],
    });
  let table = await loadWalletTable(live);
  let signed;
  try {
    signed = await sign(table);
  } catch (err) {
    if (!(err instanceof SendError && err.kind === "too_big")) throw err;
    const addresses = await collectTradeAddresses(async () => (await prepare({ fitTables })).instructions);
    table = await growWalletTable({ keypair, live, addresses });
    signed = await sign(table);
  }
  return { signed, prepared, startedAt };
}

/** Lands a stored transaction and records how that went for the stats. Returns the landing times. */
async function landAndRecord(item, live, tx) {
  try {
    const landed = await landTrade(tx);
    return landed;
  } catch (err) {
    if (err instanceof SendError && (err.kind === "failed" || err.kind === "expired")) {
      await recordTx({ item, live, tx, outcome: err.kind === "failed" ? "reverted" : "expired", error: err.message, startedAt: tx.startedAt, sentAt: err.sentAt, landedAt: err.landedAt, signature: tx.signature });
    }
    throw err;
  }
}

// ------------------------------------------------------------------ buy

async function planBuy(item, live, sim) {
  const cfg = tradingSettings(live, sim);
  if (cfg.paused) throw new Skip("new trades are paused for this wallet");
  if (await isTradingPaused()) throw new Skip("trading is paused (kill switch)");
  if (await LiveLot.exists({ liveWalletId: live._id, traderAddress: item.traderAddress, mint: item.mint })) throw new Skip("this trader's buy of this token was already taken");
  if (!(cfg.tradeSizeUsd > 0)) throw new Skip("the trade size is zero");

  const solUsd = await getSolUsd({ maxAgeMs: 2000 });
  if (!solUsd) throw new Error("The SOL price isn't available.");
  const settings = sim.settings;
  // The simulation spends the trade size and pays pump.fun's fee on top; the swap budget includes that fee, so it is sized to match.
  const budgetLamports = Math.round((cfg.tradeSizeUsd / solUsd) * (1 + (settings.pumpFeePercent ?? 1.25) / 100) * 1e9);
  const tipLamports = cfg.sendMode === "jito" ? usdToTipLamports(cfg.tipUsd, solUsd) : 0;
  const assumedTipLamports = cfg.assumedTipUsd > 0 ? Math.round((cfg.assumedTipUsd / solUsd) * 1e9) : 0;
  const mode = live.tradingMode;

  if (mode === "live") {
    const have = await solBalance(live.address);
    // A token quoted in another token is paid for with a bit more SOL than the budget, and opens up to two token accounts.
    const need = Math.round(budgetLamports * PAY_WITH_SOL_HEADROOM) + tipLamports + networkFeeLamports(400_000, cfg.priorityMicroLamports) + 2 * TOKEN_ACCOUNT_RENT_ESTIMATE;
    if (have < need) throw new Skip(`the live wallet doesn't have enough SOL (has ${lamportsToSol(have).toFixed(4)}, needs ${lamportsToSol(need).toFixed(4)})`);
  }
  return savePlan(LiveExecution, item, {
    mode,
    lotId: String(new mongoose.Types.ObjectId()),
    budgetLamports,
    tipLamports,
    assumedTipLamports,
    sendMode: cfg.sendMode,
    priorityMicroLamports: cfg.priorityMicroLamports,
    slippagePercent: live.buySlippagePercent,
    solUsd,
    tradeSizeUsd: cfg.tradeSizeUsd,
    sizeScale: cfg.scale,
    tx: null,
  });
}

function buyLeg({ venue, route, sendMode, signature, at, swapLamports, tipLamports, assumedTipLamports, feeLamports, rentLamports, tokenRaw, decimals, solUsd, verified }) {
  return {
    signature,
    venue,
    route,
    sendMode,
    at,
    swapLamports,
    tipLamports,
    assumedTipLamports,
    feeLamports,
    rentLamports,
    tokenRaw: tokenRaw.toString(),
    solUsd,
    priceUsd: swapPriceUsd(swapLamports + tipLamports + assumedTipLamports + feeLamports, tokenRaw, decimals, solUsd),
    verified,
  };
}

async function insertLot(item, live, fill, { buy, tokenRaw, decimals, tokenProgram }) {
  await LiveLot.updateOne(
    { _id: fill.lotId },
    {
      $setOnInsert: {
        liveWalletId: live._id,
        walletId: live.connectedWalletId,
        traderAddress: item.traderAddress,
        mint: item.mint,
        tokenProgram,
        decimals,
        mode: fill.mode,
        status: "open",
        openedAt: new Date(),
        sourceSignature: item.sourceSignature,
        exitMode: live.exitMode,
        // A dry run works out every style the wallet has (own, follow, its cool-downs) side by side; dryDone says they have all decided.
        ...(fill.mode === "dry" ? { dryStyles: dryStyleIds(live), dryExits: Object.fromEntries(dryStyleIds(live).map((id) => [id, null])), dryDone: false } : {}),
        sizeScale: fill.sizeScale ?? 1,
        buy,
        tokenRaw: tokenRaw.toString(),
      },
    },
    { upsert: true }
  );
}

async function executeBuy(item, live, sim) {
  const fill = item.fill ?? (item.fill = await planBuy(item, live, sim));
  if (Date.now() - item.createdAt.getTime() - (item.delaySeconds ?? 0) * 1000 > MAX_BUY_AGE_MS && !fill.tx) throw new Skip("too late to take this buy (it was not completed within 45 seconds)");

  if (fill.mode === "dry") {
    // Priced against the real chain right now, nothing sent. The owner is the live wallet, so the quote is exactly the one a real buy would get.
    const prepared = await prepareBuy({ owner: new PublicKey(live.address), mint: item.mint, budgetLamports: fill.budgetLamports, slippagePercent: fill.slippagePercent, solUsd: fill.solUsd, payWithSol: true, quoteOnly: true });
    const buy = buyLeg({
      venue: prepared.venue,
      route: prepared.route,
      sendMode: fill.sendMode,
      signature: null,
      at: new Date(),
      swapLamports: fill.budgetLamports,
      tipLamports: fill.tipLamports,
      assumedTipLamports: fill.assumedTipLamports ?? 0,
      feeLamports: fill.sendMode === "raw" ? networkFeeLamports(prepared.computeUnits, fill.priorityMicroLamports) : BASE_FEE_LAMPORTS,
      rentLamports: prepared.createsAta ? TOKEN_ACCOUNT_RENT_ESTIMATE : 0,
      tokenRaw: prepared.expectedTokenRaw,
      decimals: prepared.decimals,
      solUsd: fill.solUsd,
      verified: false,
    });
    await insertLot(item, live, fill, { buy, tokenRaw: prepared.expectedTokenRaw, decimals: prepared.decimals, tokenProgram: prepared.tokenProgram.toBase58() });
    await markDone(item);
    logEvent("trade", `[live:dry] Would have bought ${item.mint} for ${item.traderAddress}: $${fill.tradeSizeUsd.toFixed(2)} (${prepared.venue}, ${prepared.route})`, { meta: { liveWalletId: String(live._id), mint: item.mint } });
    return;
  }

  // ---- live: the signed transaction is stored first, then sent
  let tx = fill.tx;
  if (!tx) {
    tx = await withKeypair(live, async (keypair) => {
      const { signed, prepared, startedAt } = await buildLiveTx({
        live,
        keypair,
        fill,
        prepare: () => prepareBuy({ owner: keypair.publicKey, mint: item.mint, budgetLamports: fill.budgetLamports, slippagePercent: fill.slippagePercent, solUsd: fill.solUsd, payWithSol: true }),
      });
      return { ...signed, startedAt, venue: prepared.venue, route: prepared.route, decimals: prepared.decimals, tokenProgram: prepared.tokenProgram.toBase58() };
    });
    await setFill(item, { tx });
  }

  let landed;
  try {
    landed = await landAndRecord(item, live, tx);
  } catch (err) {
    if (err instanceof SendError && (err.kind === "expired" || err.kind === "failed")) await setFill(item, { tx: null }); // a fresh one is built next time
    throw err;
  }
  const outcome = await readTradeOutcome({ signature: tx.signature, owner: live.address, mint: item.mint, side: "buy", tipLamports: tx.tipLamports });
  if (outcome.failed) {
    await setFill(item, { tx: null });
    await recordTx({ item, live, tx, outcome: "reverted", error: outcome.error, startedAt: tx.startedAt, signature: tx.signature });
    throw new SendError(`The buy was refused by the chain: ${outcome.error}`, "failed");
  }
  await recordTx({ item, live, tx, outcome: "success", startedAt: tx.startedAt, sentAt: landed.sentAt, landedAt: landed.landedAt, signature: tx.signature });
  const buy = buyLeg({
    venue: tx.venue,
    route: tx.route,
    sendMode: tx.sendMode,
    signature: tx.signature,
    at: outcome.blockTime ? new Date(outcome.blockTime * 1000) : new Date(),
    swapLamports: outcome.swapLamports,
    tipLamports: outcome.tipLamports,
    assumedTipLamports: fill.assumedTipLamports ?? 0,
    feeLamports: outcome.feeLamports,
    rentLamports: outcome.rentLamports,
    tokenRaw: outcome.tokenDeltaRaw,
    decimals: tx.decimals,
    solUsd: fill.solUsd,
    verified: true,
  });
  await insertLot(item, live, fill, { buy, tokenRaw: outcome.tokenDeltaRaw, decimals: tx.decimals, tokenProgram: tx.tokenProgram });
  await markDone(item);
  invalidateChainSnapshot(live.address);
  logEvent("trade", `[live] Bought ${item.mint} for ${item.traderAddress}: ${lamportsToSol(outcome.swapLamports).toFixed(4)} SOL via ${tx.route}/${tx.sendMode}${landed.sentAt && landed.landedAt ? ` in ${landed.landedAt - tx.startedAt} ms` : ""} (${tx.signature})`, {
    meta: { liveWalletId: String(live._id), mint: item.mint, signature: tx.signature },
  });
}

// ------------------------------------------------------------------ sell

/** Tokens to sell for this lot: all it holds but one whole token, and never more than the token account really has. */
async function sellableRaw(live, lot, fill) {
  const keep = oneToken(lot.decimals);
  const held = BigInt(lot.tokenRaw);
  let amount = held > keep ? held - keep : held; // a lot of one token or less is sold whole
  if (fill.mode === "live") {
    const onChain = await onChainBalance(live, lot.mint);
    if (onChain < amount) amount = onChain; // never ask for more than the account holds
  }
  return amount;
}

async function onChainBalance(live, mint) {
  const accounts = (await rpc("getTokenAccountsByOwner", [live.address, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }])).value;
  return accounts.reduce((total, a) => total + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

function sellLeg({ venue, route, sendMode, signature, at, swapLamports, tipLamports, assumedTipLamports, feeLamports, tokenRaw, decimals, solUsd, verified }) {
  return {
    signature,
    venue,
    route,
    sendMode,
    at,
    swapLamports,
    tipLamports,
    assumedTipLamports,
    feeLamports,
    rentLamports: 0,
    tokenRaw: tokenRaw.toString(),
    solUsd,
    priceUsd: swapPriceUsd(swapLamports, tokenRaw, decimals, solUsd),
    verified,
  };
}

async function executeSell(item, live, sim) {
  const lot = await LiveLot.findOne({ liveWalletId: live._id, traderAddress: item.traderAddress, mint: item.mint });
  if (!lot) {
    // The buy may still be on its way (it is queued or being sent): wait for it, a while.
    const buying = await LiveExecution.exists({ liveWalletId: live._id, traderAddress: item.traderAddress, mint: item.mint, action: "buy", status: { $in: ["pending", "processing"] } });
    if (buying && Date.now() - item.createdAt.getTime() - (item.delaySeconds ?? 0) * 1000 < MAX_WAIT_FOR_BUY_MS) return later(item, 1);
    throw new Skip("no live position for this trader and token");
  }
  // A closed dry lot is still worked on while its other styles have not decided (db/live/trading/styles.js); nothing else is, once closed.
  if (lot.status === "closed" && !(lot.mode === "dry" && lot.dryDone === false)) return item.fill?.tx ? markDone(item) : markSkipped(item, "this position is already closed");

  let fill = item.fill;
  if (!fill) {
    const solUsd = await getSolUsd({ maxAgeMs: 2000 });
    if (!solUsd) throw new Error("The SOL price isn't available.");
    const cfg = tradingSettings(live, sim);
    const configuredTip = live.jitoTipUsd == null ? null : Math.max(0, live.jitoTipUsd);
    const assumed = cfg.sendMode === "raw" ? assumedJitoFeeUsd({ ownFeeUsd: configuredTip, simFeeUsd: Math.max(0, sim.settings.jitoFeeUsd ?? 0), scale: lot.sizeScale ?? cfg.scale, scaling: cfg.scaleJitoFee }) : 0;
    fill = item.fill = await savePlan(LiveExecution, item, {
      mode: lot.mode,
      lotId: String(lot._id),
      tipLamports: cfg.sendMode === "jito" ? usdToTipLamports(cfg.tipUsd, solUsd) : 0,
      assumedTipLamports: assumed > 0 ? Math.round((assumed / solUsd) * 1e9) : 0,
      sendMode: cfg.sendMode,
      priorityMicroLamports: cfg.priorityMicroLamports,
      slippagePercent: live.sellSlippagePercent,
      solUsd,
      sellRaw: null,
      tx: null,
    });
  }

  if (fill.mode === "dry") return executeDrySell(item, live, lot, fill);

  return executeLiveSell(item, live, lot);
}

const sum = (list, key) => list.reduce((total, stage) => total + (stage[key] || 0), 0);

/**
 * A live sale. A token quoted in SOL is one transaction. A token quoted in other tokens is sold down the chain to SOL (db/live/trading/sellChain.js): as
 * many swaps as fit one transaction go together; if the whole chain doesn't fit, the first transaction sells the token itself for the token it is quoted in
 * (or as far down as it can), and the next transactions sell what the one before paid out, until SOL is reached. Each landed stage is written on the lot
 * before the next is built, so a sale that is interrupted - or gave up - carries on from what it holds, never from the token that is already sold.
 *
 * Only the first transaction is sent the way the wallet is set to (Jito or raw): it is the one that sells the token the position is in, and the
 * price that counts. Every later one is raw - no tip, only the priority fee.
 */
async function executeLiveSell(item, live, lot) {
  for (;;) {
    const fill = item.fill;
    if (!fill.tx) {
      const carry = lot.sellCarry?.mint ? lot.sellCarry : null;
      const fromMint = carry?.mint ?? item.mint;
      let sellRaw;
      if (carry) {
        sellRaw = BigInt(carry.raw);
        const held = await onChainBalance(live, fromMint);
        if (held < sellRaw) sellRaw = held;
      } else {
        sellRaw = fill.sellRaw ? BigInt(fill.sellRaw) : await sellableRaw(live, lot, fill);
      }
      if (sellRaw <= 0n) throw new Skip(carry ? `nothing is left of ${fromMint}, which an earlier part of this sale was paid in` : "the wallet no longer holds any of this token");
      const continuing = lot.sellStages.length > 0; // an earlier transaction of this sale has landed
      const stageFill = continuing ? { ...fill, sendMode: "raw", tipLamports: 0 } : fill;
      const tx = await withKeypair(live, async (keypair) => {
        const { signed, prepared, startedAt } = await buildLiveTx({
          live,
          keypair,
          fill: stageFill,
          prepare: ({ fitTables }) => prepareSell({ owner: keypair.publicKey, mint: item.mint, from: fromMint, tokenRaw: sellRaw, slippagePercent: fill.slippagePercent, solUsd: fill.solUsd, payWithSol: true, fitTables }),
        });
        const stage = prepared.stage ? { fromMint: prepared.stage.fromMint, toMint: prepared.stage.toMint, final: prepared.stage.final } : { fromMint: item.mint, toMint: WSOL_MINT, final: true };
        return { ...signed, startedAt, venue: prepared.venue, route: prepared.route, decimals: prepared.decimals, stage, inRaw: sellRaw.toString() };
      });
      await setFill(item, { sellRaw: continuing ? null : sellRaw.toString(), tx });
    }

    const tx = item.fill.tx;
    const stage = tx.stage ?? { fromMint: item.mint, toMint: WSOL_MINT, final: true };
    let landed;
    try {
      landed = await landAndRecord(item, live, tx);
    } catch (err) {
      if (err instanceof SendError && (err.kind === "expired" || err.kind === "failed")) await setFill(item, { tx: null, sellRaw: null });
      throw err;
    }
    const outcome = await readTradeOutcome({ signature: tx.signature, owner: live.address, mint: stage.fromMint, side: "sell", tipLamports: tx.tipLamports, outMint: stage.final ? null : stage.toMint });
    if (outcome.failed) {
      await setFill(item, { tx: null, sellRaw: null });
      await recordTx({ item, live, tx, outcome: "reverted", error: outcome.error, startedAt: tx.startedAt, signature: tx.signature });
      throw new SendError(`The sell was refused by the chain: ${outcome.error}`, "failed");
    }
    await recordTx({ item, live, tx, outcome: "success", startedAt: tx.startedAt, sentAt: landed.sentAt, landedAt: landed.landedAt, signature: tx.signature });
    const at = outcome.blockTime ? new Date(outcome.blockTime * 1000) : new Date();
    const record = {
      signature: tx.signature,
      fromMint: stage.fromMint,
      toMint: stage.toMint,
      inRaw: (-outcome.tokenDeltaRaw).toString(),
      outRaw: stage.final ? null : outcome.outDeltaRaw.toString(),
      swapLamports: outcome.swapLamports,
      tipLamports: outcome.tipLamports,
      feeLamports: outcome.feeLamports,
      sendMode: tx.sendMode,
      venue: tx.venue,
      route: tx.route,
      at,
    };
    const recorded = lot.sellStages.some((done) => done.signature === tx.signature); // this stage was written before a restart
    const previous = lot.sellStages.filter((done) => done.signature !== tx.signature);

    if (!stage.final) {
      if (!recorded) {
        const carry = { mint: stage.toMint, raw: outcome.outDeltaRaw.toString() };
        await LiveLot.updateOne({ _id: lot._id, status: "open" }, { $push: { sellStages: record }, $set: { sellCarry: carry } });
        lot.sellStages.push(record);
        lot.sellCarry = carry;
      }
      await setFill(item, { tx: null, sellRaw: null });
      await LiveExecution.updateOne({ _id: item._id }, { $set: { leaseUntil: new Date(Date.now() + LIVE_LEASE_MS) } }); // the next transaction is a whole new landing
      invalidateChainSnapshot(live.address);
      logEvent("trade", `[live] Sold ${item.mint} for ${item.traderAddress} as far as ${stage.toMint} (${tx.route}/${tx.sendMode}, ${tx.signature}); selling that on down to SOL`, {
        meta: { liveWalletId: String(live._id), mint: item.mint, signature: tx.signature },
      });
      continue;
    }

    const first = previous[0] ?? record;
    const sell = sellLeg({
      venue: first.venue,
      route: previous.length ? "chain" : tx.route,
      sendMode: first.sendMode,
      signature: tx.signature,
      at,
      swapLamports: outcome.swapLamports,
      tipLamports: sum(previous, "tipLamports") + outcome.tipLamports,
      assumedTipLamports: item.fill.assumedTipLamports ?? 0,
      feeLamports: sum(previous, "feeLamports") + outcome.feeLamports,
      tokenRaw: BigInt(first.inRaw),
      decimals: tx.decimals,
      solUsd: item.fill.solUsd,
      verified: true,
    });
    const result = settle(lot.buy, sell);
    const closed = await LiveLot.findOneAndUpdate(
      { _id: lot._id, status: "open" },
      { $set: { status: "closed", closedAt: new Date(), sell, closeReason: item.closeReason, sellFailure: null, sellCarry: null, ...result }, $push: { sellStages: record } },
      { returnDocument: "after" }
    );
    await markDone(item);
    invalidateChainSnapshot(live.address);
    if (closed) {
      logEvent("trade", `[live] Sold ${item.mint} for ${item.traderAddress}: ${item.closeReason} pnl=$${result.realizedPnlUsd.toFixed(2)} (${result.realizedPnlPercent.toFixed(1)}%) via ${sell.route}/${tx.sendMode}${previous.length ? ` in ${previous.length + 1} transactions` : ""} (${tx.signature})`, {
        meta: { liveWalletId: String(live._id), mint: item.mint, signature: tx.signature, realizedPnlUsd: result.realizedPnlUsd },
      });
    }
    return;
  }
}

/**
 * A dry-run sell: what the chain would pay for the lot's tokens right now, recorded for the exit style(s) that decided it. The lot closes the moment the style
 * the wallet is set to has decided; the other styles are recorded whenever they decide, before or after (a lot is "done" once all of them have).
 */
async function executeDrySell(item, live, lot, fill) {
  const styles = lotStyleIds(lot);
  const tracks = item.track ? [item.track].filter((id) => styles.includes(id)) : styles; // a trader's sell or a blacklisting settles every way at once
  const todo = tracks.filter((track) => !lot.dryExits?.[track]);
  // A trade the simulation never took has no simulated exit to follow: its "follow" way takes the exit "own" makes, at the same moment.
  if (todo.includes("own") && styles.includes("follow") && !lot.dryExits?.follow && !todo.includes("follow") && (lot.unpaired || (await findUnpaired([lot])).length > 0)) {
    todo.push("follow");
    if (!lot.unpaired) await LiveLot.updateOne({ _id: lot._id }, { $set: { unpaired: true } });
  }
  if (todo.length === 0) return markDone(item);

  const sellRaw = await sellableRaw(live, lot, fill);
  if (sellRaw <= 0n) throw new Skip("nothing left to sell in this lot");
  const prepared = await prepareSell({ owner: new PublicKey(live.address), mint: item.mint, tokenRaw: sellRaw, slippagePercent: fill.slippagePercent, solUsd: fill.solUsd, payWithSol: true, quoteOnly: true });
  const swapLamports = Number(prepared.expectedLamports);
  const feeLamports = fill.sendMode === "raw" ? networkFeeLamports(prepared.computeUnits, fill.priorityMicroLamports) : BASE_FEE_LAMPORTS;
  const sell = sellLeg({
    venue: prepared.venue,
    route: prepared.route,
    sendMode: fill.sendMode,
    signature: null,
    at: new Date(),
    swapLamports,
    tipLamports: fill.tipLamports,
    assumedTipLamports: fill.assumedTipLamports ?? 0,
    feeLamports,
    tokenRaw: sellRaw,
    decimals: prepared.decimals,
    solUsd: fill.solUsd,
    verified: false,
  });
  const result = settle(lot.buy, sell);
  const exit = {
    reason: item.closeReason,
    at: new Date(),
    priceUsd: sell.priceUsd,
    swapLamports,
    netLamports: swapLamports - fill.tipLamports - (fill.assumedTipLamports ?? 0) - feeLamports,
    proceedsUsd: result.proceedsUsd,
    realizedPnlUsd: result.realizedPnlUsd,
    realizedPnlPercent: result.realizedPnlPercent,
  };

  const $set = Object.fromEntries(todo.map((track) => [`dryExits.${track}`, exit]));
  // The style the wallet is set to has decided: the position is closed with this exit.
  const closes = lot.status === "open" && todo.includes(styles.includes(selectedStyleId(live)) ? selectedStyleId(live) : "own");
  if (closes) {
    Object.assign($set, { status: "closed", closedAt: new Date(), closeReason: exit.reason, sell, costUsd: result.costUsd, proceedsUsd: result.proceedsUsd, realizedPnlUsd: result.realizedPnlUsd, realizedPnlPercent: result.realizedPnlPercent });
  }
  const updated = await LiveLot.findOneAndUpdate(closes ? { _id: lot._id, status: "open" } : { _id: lot._id }, { $set }, { returnDocument: "after" });
  if (updated && updated.dryDone === false && styles.every((id) => updated.dryExits?.[id])) await LiveLot.updateOne({ _id: lot._id }, { $set: { dryDone: true } });
  await markDone(item);
  logEvent("trade", `[live:dry] Would have sold ${item.mint} for ${item.traderAddress} (${todo.join("+")}): ${item.closeReason} pnl=$${result.realizedPnlUsd.toFixed(2)}`, { meta: { liveWalletId: String(live._id), mint: item.mint } });
}

// ------------------------------------------------------------------ the loop

async function runItem(item) {
  const attemptStartedAt = Date.now();
  let live = null;
  try {
    live = await LiveWallet.findById(item.liveWalletId).select("+encryptedSecret");
    if (!live || !live.connectedWalletId) return markSkipped(item, "the live wallet is no longer connected");
    const sim = await Wallet.findById(live.connectedWalletId);
    if (!sim) return markSkipped(item, "the simulation wallet no longer exists");
    if (item.action === "buy") await executeBuy(item, live, sim);
    else await executeSell(item, live, sim);
  } catch (err) {
    if (err instanceof Skip) return markSkipped(item, err.message);
    if (err instanceof SendError && err.kind === "too_big") {
      if (item.action === "sell") await flagSellFailure(item, err.message);
      return markSkipped(item, err.message);
    }
    if (err instanceof OutcomeError) {
      // The trade DID land; only reading it back failed. Retried (the stored signature is looked up again), never rebuilt.
      logEvent("trade", `[live] Couldn't read the result of ${item.action} ${item.mint} yet: ${err.message}`, { level: "warn", meta: { mint: item.mint } });
    } else if (live && item.fill?.mode === "live" && (!(err instanceof SendError) || err.kind === "too_big")) {
      // It never reached the chain: an attempt that failed while being built or sent. (Landed-and-refused and expired ones are recorded where they happen.)
      await recordTx({ item, live, tx: item.fill?.tx, outcome: "error", error: safeReason(err), startedAt: attemptStartedAt });
    }
    const result = await failOrRetry(LiveExecution, item, err, { max: RETRIES[item.action], backoff: retryDelayMs[item.action] });
    if (result === "skipped" && item.action === "sell") {
      const fresh = await LiveExecution.findById(item._id, { skipReason: 1 }).lean();
      if (/after retries/.test(fresh?.skipReason ?? "")) await flagSellFailure(item, safeReason(err));
    }
  }
}

/** Claims what is due and works on it (several at once - one trade waiting for the chain never holds up another). Overlap-safe like the simulation's. */
export async function processDueLiveExecutions() {
  await reapStale(LiveExecution);
  const due = await LiveExecution.find({ status: "pending", triggerAt: { $lte: new Date() } })
    .sort({ action: -1, triggerAt: 1 }) // exits before entries
    .limit(BATCH);
  const claimed = [];
  for (const item of due) {
    const got = await LiveExecution.findOneAndUpdate(
      { _id: item._id, status: "pending" },
      { $set: { status: "processing", leaseUntil: new Date(Date.now() + LIVE_LEASE_MS) } },
      { returnDocument: "after" }
    );
    if (got) claimed.push(got);
  }
  await Promise.allSettled(claimed.map(runItem));
  return claimed.length;
}
