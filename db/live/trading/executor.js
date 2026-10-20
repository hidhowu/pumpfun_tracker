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
import { prepareBuy, prepareSell } from "./pumpSwap.js";
import { usdToTipLamports } from "./jito.js";
import { SendError, buildSignedTrade, landTrade } from "./liveTx.js";
import { OutcomeError, readTradeOutcome } from "./outcome.js";
import { oneToken, settle, swapPriceUsd } from "./lots.js";

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
const NETWORK_FEE_LAMPORTS = 5000;
const TOKEN_ACCOUNT_RENT_ESTIMATE = 2_100_000; // what opening a token account holds (a bit above the usual 0.00204 SOL)
const BATCH = 8;
const MAX_WAIT_FOR_BUY_MS = 60_000;

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

// ------------------------------------------------------------------ buy

async function planBuy(item, live, sim) {
  if (await isTradingPaused()) throw new Skip("trading is paused (kill switch)");
  if (await LiveLot.exists({ liveWalletId: live._id, traderAddress: item.traderAddress, mint: item.mint })) throw new Skip("this trader's buy of this token was already taken");

  const solUsd = await getSolUsd({ maxAgeMs: 2000 });
  if (!solUsd) throw new Error("The SOL price isn't available.");
  const settings = sim.settings;
  // The simulation spends the trade size and pays pump.fun's fee on top; the swap budget includes that fee, so it is sized to match.
  const budgetLamports = Math.round((settings.tradeSizeUsd / solUsd) * (1 + (settings.pumpFeePercent ?? 1.25) / 100) * 1e9);
  const tipLamports = usdToTipLamports(settings.jitoFeeUsd ?? 0, solUsd);
  const mode = live.tradingMode;

  if (mode === "live") {
    const have = await solBalance(live.address);
    const need = budgetLamports + tipLamports + NETWORK_FEE_LAMPORTS + TOKEN_ACCOUNT_RENT_ESTIMATE;
    if (have < need) throw new Skip(`the live wallet doesn't have enough SOL (has ${lamportsToSol(have).toFixed(4)}, needs ${lamportsToSol(need).toFixed(4)})`);
  }
  return savePlan(LiveExecution, item, {
    mode,
    lotId: String(new mongoose.Types.ObjectId()),
    budgetLamports,
    tipLamports,
    slippagePercent: live.buySlippagePercent,
    solUsd,
    tradeSizeUsd: settings.tradeSizeUsd,
    tx: null,
  });
}

function buyLeg({ venue, signature, at, swapLamports, tipLamports, feeLamports, rentLamports, tokenRaw, decimals, solUsd, verified }) {
  return {
    signature,
    venue,
    at,
    swapLamports,
    tipLamports,
    feeLamports,
    rentLamports,
    tokenRaw: tokenRaw.toString(),
    solUsd,
    priceUsd: swapPriceUsd(swapLamports + tipLamports + feeLamports, tokenRaw, decimals, solUsd),
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
        buy,
        tokenRaw: tokenRaw.toString(),
      },
    },
    { upsert: true }
  );
}

async function executeBuy(item, live, sim) {
  const fill = item.fill ?? (item.fill = await planBuy(item, live, sim));

  if (fill.mode === "dry") {
    // Priced against the real chain right now, nothing sent. The owner is the live wallet, so the quote is exactly the one a real buy would get.
    const prepared = await prepareBuy({ owner: new PublicKey(live.address), mint: item.mint, budgetLamports: fill.budgetLamports, slippagePercent: fill.slippagePercent });
    const buy = buyLeg({
      venue: prepared.venue,
      signature: null,
      at: new Date(),
      swapLamports: fill.budgetLamports,
      tipLamports: fill.tipLamports,
      feeLamports: NETWORK_FEE_LAMPORTS,
      rentLamports: prepared.createsAta ? TOKEN_ACCOUNT_RENT_ESTIMATE : 0,
      tokenRaw: prepared.expectedTokenRaw,
      decimals: prepared.decimals,
      solUsd: fill.solUsd,
      verified: false,
    });
    await insertLot(item, live, fill, { buy, tokenRaw: prepared.expectedTokenRaw, decimals: prepared.decimals, tokenProgram: prepared.tokenProgram.toBase58() });
    await markDone(item);
    logEvent("trade", `[live:dry] Would have bought ${item.mint} for ${item.traderAddress}: $${fill.tradeSizeUsd} (${prepared.venue})`, { meta: { liveWalletId: String(live._id), mint: item.mint } });
    return;
  }

  // ---- live: the signed transaction is stored first, then sent
  let tx = fill.tx;
  if (!tx) {
    tx = await withKeypair(live, async (keypair) => {
      const prepared = await prepareBuy({ owner: keypair.publicKey, mint: item.mint, budgetLamports: fill.budgetLamports, slippagePercent: fill.slippagePercent });
      const signed = await buildSignedTrade({ keypair, instructions: prepared.instructions, tipLamports: fill.tipLamports });
      return { ...signed, venue: prepared.venue, decimals: prepared.decimals, tokenProgram: prepared.tokenProgram.toBase58() };
    });
    await setFill(item, { tx });
  }

  try {
    await landTrade(tx);
  } catch (err) {
    if (err instanceof SendError && (err.kind === "expired" || err.kind === "failed")) await setFill(item, { tx: null }); // a fresh one is built next time
    throw err;
  }
  const outcome = await readTradeOutcome({ signature: tx.signature, owner: live.address, mint: item.mint, side: "buy", tipLamports: tx.tipLamports });
  if (outcome.failed) {
    await setFill(item, { tx: null });
    throw new Error(`The buy was refused by the chain: ${outcome.error}`);
  }
  const buy = buyLeg({
    venue: tx.venue,
    signature: tx.signature,
    at: outcome.blockTime ? new Date(outcome.blockTime * 1000) : new Date(),
    swapLamports: outcome.swapLamports,
    tipLamports: outcome.tipLamports,
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
  logEvent("trade", `[live] Bought ${item.mint} for ${item.traderAddress}: ${lamportsToSol(outcome.swapLamports).toFixed(4)} SOL, tip ${lamportsToSol(outcome.tipLamports).toFixed(5)} SOL (${tx.signature})`, {
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
    const accounts = (await rpc("getTokenAccountsByOwner", [live.address, { mint: lot.mint }, { encoding: "jsonParsed", commitment: "confirmed" }])).value;
    const onChain = accounts.reduce((total, a) => total + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
    if (onChain < amount) amount = onChain; // never ask for more than the account holds
  }
  return amount;
}

function sellLeg({ venue, signature, at, swapLamports, tipLamports, feeLamports, tokenRaw, decimals, solUsd, verified }) {
  return {
    signature,
    venue,
    at,
    swapLamports,
    tipLamports,
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
    if (buying && Date.now() - item.createdAt.getTime() < MAX_WAIT_FOR_BUY_MS) return later(item, 1);
    throw new Skip("no live position for this trader and token");
  }
  if (lot.status === "closed") return item.fill?.tx ? markDone(item) : markSkipped(item, "this position is already closed");

  let fill = item.fill;
  if (!fill) {
    const solUsd = await getSolUsd({ maxAgeMs: 2000 });
    if (!solUsd) throw new Error("The SOL price isn't available.");
    fill = item.fill = await savePlan(LiveExecution, item, {
      mode: lot.mode,
      lotId: String(lot._id),
      tipLamports: usdToTipLamports(sim.settings.jitoFeeUsd ?? 0, solUsd),
      slippagePercent: live.sellSlippagePercent,
      solUsd,
      sellRaw: null,
      tx: null,
    });
  }

  if (fill.mode === "dry") return executeDrySell(item, live, lot, fill);

  if (!fill.tx) {
    const sellRaw = fill.sellRaw ? BigInt(fill.sellRaw) : await sellableRaw(live, lot, fill);
    if (sellRaw <= 0n) throw new Skip("the wallet no longer holds any of this token");
    const tx = await withKeypair(live, async (keypair) => {
      const prepared = await prepareSell({ owner: keypair.publicKey, mint: item.mint, tokenRaw: sellRaw, slippagePercent: fill.slippagePercent });
      const signed = await buildSignedTrade({ keypair, instructions: prepared.instructions, tipLamports: fill.tipLamports });
      return { ...signed, venue: prepared.venue, decimals: prepared.decimals };
    });
    await setFill(item, { sellRaw: sellRaw.toString(), tx });
  }

  const tx = item.fill.tx;
  try {
    await landTrade(tx);
  } catch (err) {
    if (err instanceof SendError && (err.kind === "expired" || err.kind === "failed")) await setFill(item, { tx: null, sellRaw: null });
    throw err;
  }
  const outcome = await readTradeOutcome({ signature: tx.signature, owner: live.address, mint: item.mint, side: "sell", tipLamports: tx.tipLamports });
  if (outcome.failed) {
    await setFill(item, { tx: null, sellRaw: null });
    throw new Error(`The sell was refused by the chain: ${outcome.error}`);
  }
  const sell = sellLeg({
    venue: tx.venue,
    signature: tx.signature,
    at: outcome.blockTime ? new Date(outcome.blockTime * 1000) : new Date(),
    swapLamports: outcome.swapLamports,
    tipLamports: outcome.tipLamports,
    feeLamports: outcome.feeLamports,
    tokenRaw: -outcome.tokenDeltaRaw,
    decimals: tx.decimals,
    solUsd: fill.solUsd,
    verified: true,
  });
  const result = settle(lot.buy, sell);
  const closed = await LiveLot.findOneAndUpdate(
    { _id: lot._id, status: "open" },
    { $set: { status: "closed", closedAt: new Date(), sell, closeReason: item.closeReason, ...result } },
    { returnDocument: "after" }
  );
  await markDone(item);
  invalidateChainSnapshot(live.address);
  if (closed) {
    logEvent("trade", `[live] Sold ${item.mint} for ${item.traderAddress}: ${item.closeReason} pnl=$${result.realizedPnlUsd.toFixed(2)} (${result.realizedPnlPercent.toFixed(1)}%) (${tx.signature})`, {
      meta: { liveWalletId: String(live._id), mint: item.mint, signature: tx.signature, realizedPnlUsd: result.realizedPnlUsd },
    });
  }
}

/** A dry-run sell: what the chain would pay for the lot's tokens right now, recorded for the exit mode(s) that decided it. */
async function executeDrySell(item, live, lot, fill) {
  const tracks = item.track ? [item.track] : ["own", "follow"]; // a trader's sell or a blacklisting settles both ways at once
  const todo = tracks.filter((track) => !lot.dryExits?.[track]);
  if (todo.length === 0 || lot.status === "closed") return markDone(item);

  const sellRaw = await sellableRaw(live, lot, fill);
  if (sellRaw <= 0n) throw new Skip("nothing left to sell in this lot");
  const prepared = await prepareSell({ owner: new PublicKey(live.address), mint: item.mint, tokenRaw: sellRaw, slippagePercent: fill.slippagePercent, quoteOnly: true });
  const swapLamports = Number(prepared.expectedLamports);
  const sell = sellLeg({
    venue: prepared.venue,
    signature: null,
    at: new Date(),
    swapLamports,
    tipLamports: fill.tipLamports,
    feeLamports: NETWORK_FEE_LAMPORTS,
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
    netLamports: swapLamports - fill.tipLamports - NETWORK_FEE_LAMPORTS,
    proceedsUsd: result.proceedsUsd,
    realizedPnlUsd: result.realizedPnlUsd,
    realizedPnlPercent: result.realizedPnlPercent,
  };

  const $set = Object.fromEntries(todo.map((track) => [`dryExits.${track}`, exit]));
  const updated = await LiveLot.findOneAndUpdate({ _id: lot._id, status: "open" }, { $set }, { returnDocument: "after" });
  if (updated?.dryExits?.own && updated?.dryExits?.follow) {
    // Both ways have decided: the lot is settled by the exit mode the wallet is set to.
    const chosen = updated.dryExits[live.exitMode] ?? updated.dryExits.own;
    await LiveLot.updateOne(
      { _id: lot._id, status: "open" },
      {
        $set: {
          status: "closed",
          closedAt: new Date(),
          closeReason: chosen.reason,
          sell: { ...sell, swapLamports: chosen.netLamports + fill.tipLamports + NETWORK_FEE_LAMPORTS, priceUsd: chosen.priceUsd },
          costUsd: result.costUsd,
          proceedsUsd: chosen.proceedsUsd,
          realizedPnlUsd: chosen.realizedPnlUsd,
          realizedPnlPercent: chosen.realizedPnlPercent,
        },
      }
    );
  }
  await markDone(item);
  logEvent("trade", `[live:dry] Would have sold ${item.mint} for ${item.traderAddress} (${todo.join("+")}): ${item.closeReason} pnl=$${result.realizedPnlUsd.toFixed(2)}`, { meta: { liveWalletId: String(live._id), mint: item.mint } });
}

// ------------------------------------------------------------------ the loop

async function runItem(item) {
  try {
    const live = await LiveWallet.findById(item.liveWalletId).select("+encryptedSecret");
    if (!live || !live.connectedWalletId) return markSkipped(item, "the live wallet is no longer connected");
    const sim = await Wallet.findById(live.connectedWalletId);
    if (!sim) return markSkipped(item, "the simulation wallet no longer exists");
    if (item.action === "buy") await executeBuy(item, live, sim);
    else await executeSell(item, live, sim);
  } catch (err) {
    if (err instanceof Skip) return markSkipped(item, err.message);
    if (err instanceof SendError && err.kind === "too_big") return markSkipped(item, err.message);
    if (err instanceof OutcomeError) {
      // The trade DID land; only reading it back failed. Retried (the stored signature is looked up again), never rebuilt.
      logEvent("trade", `[live] Couldn't read the result of ${item.action} ${item.mint} yet: ${err.message}`, { level: "warn", meta: { mint: item.mint } });
    }
    await failOrRetry(LiveExecution, item, err);
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
