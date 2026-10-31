import mongoose from "mongoose";
import { LiveWallet } from "../../models/LiveWallet.js";
import { LiveLot } from "../../models/LiveLot.js";
import { LiveExecution } from "../../models/LiveExecution.js";
import { Wallet } from "../../models/Wallet.js";
import { isTwoFactorEnabled, verifyTwoFactorStepUp } from "../../authService.js";
import { getPrice, prefetchPrices, PRICE_MAX_AGE } from "../../pumpFunApi.js";
import { getSolUsd } from "../../onchainPrice.js";
import { logEvent } from "../../systemLog.js";
import { isTradingPaused } from "../../simulation/guards.js";
import { isWalletEncryptionConfigured } from "../walletKeys.js";
import { getTokenMeta } from "../tokenMeta.js";
import { getChainSnapshot } from "../chain.js";
import { EMPTY_MAX_TOKENS, SWEEP_EVERY_MS, sweepWallet } from "./burnEngine.js";
import { buyCostUsd, lotValueUsd } from "./lots.js";
import { MAX_PRIORITY_MICRO_LAMPORTS, MAX_TIP_USD, MAX_TRADE_DELAY_SECONDS, RATIO_MAX, RATIO_MIN, tradingSettings } from "./settings.js";
import { listStuckSells } from "./alerts.js";
import { getTxStats } from "./txStats.js";
import { COOLDOWN_DEFAULT_STOP_PERCENT, COOLDOWN_MAX_SECONDS, COOLDOWN_MAX_STYLES, COOLDOWN_MIN_SECONDS, cooldownStylesOf, lotStyleIds, styleLabel } from "./styles.js";
import { createWalletTable, loadWalletTable } from "./lookupTable.js";
import { resolveMarket } from "./market.js";
import { prepareBuy } from "./pumpSwap.js";
import { pumpSdks } from "./sdk.js";
import { WalletPosition } from "../../models/WalletPosition.js";
import { pickRpcUrl, rpc } from "../../onchainPrice.js";
import { base58Decode, base58Encode, decryptWalletSecret } from "../walletKeys.js";
import { Connection, Keypair } from "@solana/web3.js";

/**
 * Everything the pages need about a live wallet's copy trading: the link to a simulation wallet and its switches (changed only with two-factor
 * on, and going LIVE needs a fresh authenticator code), the trades side by side with the simulation's, and the totals.
 */

export class TradingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const LAMPORTS = 1e9;

// ------------------------------------------------------------------ connection

function simView(wallet) {
  if (!wallet) return null;
  const s = wallet.settings;
  return {
    _id: String(wallet._id),
    name: wallet.name,
    balanceUsd: wallet.balanceUsd,
    startingBalanceUsd: wallet.startingBalanceUsd,
    realizedPnlUsd: wallet.realizedPnlUsd,
    settings: {
      tradeSizeUsd: s.tradeSizeUsd,
      pumpFeePercent: s.pumpFeePercent,
      jitoFeeUsd: s.jitoFeeUsd,
      stopLossPercent: s.stopLossPercent,
      takeProfitPercent: s.takeProfitPercent,
      maxTradeTimeSeconds: s.maxTradeTimeSeconds,
      trailingStops: (s.trailingStops || []).map((t) => ({ armPercent: t.armPercent, exitPercent: t.exitPercent })),
      executionDelaySeconds: s.executionDelaySeconds,
    },
  };
}

/** The copy-trading state of one live wallet. */
export async function getTradingState(liveId) {
  const live = await LiveWallet.findById(liveId).lean();
  if (!live) return null;
  const [sim, availableWallets, paused, solUsd] = await Promise.all([
    live.connectedWalletId ? Wallet.findById(live.connectedWalletId).lean() : null,
    Wallet.find({ mode: { $ne: "live" } }, { name: 1 }).sort({ createdAt: 1 }).lean(),
    isTradingPaused(),
    getSolUsd(),
  ]);
  const taken = new Set((await LiveWallet.find({ connectedWalletId: { $ne: null }, _id: { $ne: live._id } }, { connectedWalletId: 1 }).lean()).map((w) => String(w.connectedWalletId)));

  const cfg = tradingSettings(live, sim);
  const stuck = await listStuckSells(live._id);

  const warnings = [];
  if (sim && cfg.sendMode === "jito" && cfg.tipUsd <= 0) warnings.push("The Jito tip is $0, so transactions are tipped only Jito's minimum (about $0.0002) and will rarely land fast. Set a Jito tip here, or a Jito fee on the simulation wallet.");
  if (paused) warnings.push("New buys are paused by the kill switch.");
  if (cfg.paused) warnings.push("This wallet is paused: it takes no new trades. Positions already open are still sold when they exit.");
  if (!isWalletEncryptionConfigured()) warnings.push("WALLET_ENCRYPTION_KEY isn't set on the server, so the wallet's key can't be used to trade.");

  return {
    connected: !!sim,
    tradingMode: live.tradingMode,
    exitMode: live.exitMode,
    cooldownStyles: cooldownStylesOf(live).map(({ id, seconds, stopLossPercent }) => ({ id, seconds, stopLossPercent })),
    buySlippagePercent: live.buySlippagePercent ?? 15,
    sellSlippagePercent: live.sellSlippagePercent ?? 25,
    tradeDelaySeconds: cfg.delaySeconds,
    maxTradeDelaySeconds: MAX_TRADE_DELAY_SECONDS,
    sendMode: cfg.sendMode,
    jitoTipUsd: live.jitoTipUsd ?? null,
    scaleJitoFee: cfg.scaleJitoFee,
    rawPriorityMicroLamports: cfg.priorityMicroLamports,
    tradeRatioSim: cfg.ratioSim,
    tradeRatioLive: cfg.ratioLive,
    paused: cfg.paused,
    lookupTable: live.lookupTable ?? null,
    lookupTableAddresses: (await getTableInfo(live)).addresses,
    effective: sim ? { tradeSizeUsd: cfg.tradeSizeUsd, tipUsd: cfg.tipUsd, assumedTipUsd: cfg.assumedTipUsd, scale: cfg.scale } : null,
    stuckSells: stuck.map((l) => ({ lotId: String(l._id), mint: l.mint, traderAddress: l.traderAddress, at: l.sellFailure.at, reason: l.sellFailure.reason, failures: l.sellFailure.failures })),
    connectedAt: live.connectedAt,
    lastBurnSweepAt: live.lastBurnSweepAt,
    burnSweepEveryMinutes: SWEEP_EVERY_MS / 60000,
    emptyTokenLimit: EMPTY_MAX_TOKENS,
    solUsd,
    simWallet: simView(sim),
    availableWallets: availableWallets.map((w) => ({ _id: String(w._id), name: w.name, taken: taken.has(String(w._id)) })),
    warnings,
  };
}

const SLIPPAGE_MIN = 1;
const SLIPPAGE_MAX = 90;

/**
 * @param {string} liveId
 * @param {{ connectedWalletId?: string | null, tradingMode?: "dry" | "live", exitMode?: "own" | "follow" | string, cooldownStyles?: { seconds: number, stopLossPercent?: number }[], buySlippagePercent?: number, sellSlippagePercent?: number, tradeDelaySeconds?: number,
 *   sendMode?: "raw" | "jito", jitoTipUsd?: number | null, scaleJitoFee?: boolean, rawPriorityMicroLamports?: number, tradeRatioSim?: number, tradeRatioLive?: number, paused?: boolean }} patch
 * @param {{ userId: string, username: string, code?: string, ip?: string }} actor
 */
export async function updateTrading(liveId, patch, { userId, username, code, ip }) {
  if (!(await isTwoFactorEnabled(userId))) throw new TradingError("Two-factor sign-in must be turned on (Account page) before you can change what a live wallet trades.", 403);
  const live = await LiveWallet.findById(liveId);
  if (!live) throw new TradingError("Wallet not found", 404);

  const set = {};

  if ("connectedWalletId" in patch) {
    const next = patch.connectedWalletId ? String(patch.connectedWalletId) : null;
    const current = live.connectedWalletId ? String(live.connectedWalletId) : null;
    if (next !== current) {
      const holding = await LiveLot.countDocuments({ liveWalletId: live._id, status: "open", mode: "live" });
      if (holding > 0) throw new TradingError(`This wallet still holds ${holding} live position${holding === 1 ? "" : "s"}. Let them close (or sell them) before changing the connection.`, 409);
      const pending = await LiveExecution.countDocuments({ liveWalletId: live._id, status: { $in: ["pending", "processing"] } });
      if (pending > 0) throw new TradingError("Trades are still being worked on. Try again in a moment.", 409);
      if (next) {
        if (!mongoose.isValidObjectId(next)) throw new TradingError("Choose a simulation wallet.");
        const sim = await Wallet.findById(next, { mode: 1 }).lean();
        if (!sim) throw new TradingError("That simulation wallet doesn't exist.", 404);
        if (sim.mode === "live") throw new TradingError("That wallet can't be connected.");
        set.connectedWalletId = sim._id;
        set.connectedAt = new Date();
        set.tradingMode = "dry"; // a new connection always starts as a dry run
      } else {
        set.connectedWalletId = null;
        set.connectedAt = null;
        set.tradingMode = "dry";
      }
    }
  }

  if (patch.cooldownStyles !== undefined) {
    if (!Array.isArray(patch.cooldownStyles) || patch.cooldownStyles.length > COOLDOWN_MAX_STYLES) throw new TradingError(`Give a list of at most ${COOLDOWN_MAX_STYLES} cool-down styles.`);
    const seen = new Set();
    set.cooldownStyles = patch.cooldownStyles.map((c) => {
      const seconds = Math.round(Number(c?.seconds));
      const stopLossPercent = c?.stopLossPercent == null ? COOLDOWN_DEFAULT_STOP_PERCENT : Number(c.stopLossPercent);
      if (!Number.isFinite(seconds) || seconds < COOLDOWN_MIN_SECONDS || seconds > COOLDOWN_MAX_SECONDS) throw new TradingError(`A cool-down must be between ${COOLDOWN_MIN_SECONDS} seconds and ${COOLDOWN_MAX_SECONDS / 3600} hours.`);
      if (!Number.isFinite(stopLossPercent) || stopLossPercent <= 0 || stopLossPercent > 100) throw new TradingError("The stop-loss during a cool-down must be between 0 and 100 (50 means -50%).");
      if (seen.has(seconds)) throw new TradingError("Two cool-down styles have the same length.");
      seen.add(seconds);
      return { seconds, stopLossPercent };
    });
  }
  {
    // The exit rules must name a style the wallet has (counting the cool-down styles being saved in this same change).
    const styleIds = ["own", "follow", ...cooldownStylesOf({ cooldownStyles: set.cooldownStyles ?? live.cooldownStyles }).map((c) => c.id)];
    const next = patch.exitMode ?? live.exitMode ?? "own";
    if (!styleIds.includes(next)) throw new TradingError(patch.exitMode !== undefined ? "Choose 'own', 'follow' or one of the cool-down styles." : "The exit rules are set to a cool-down style that is being removed. Choose another first.");
    if (patch.exitMode !== undefined) set.exitMode = patch.exitMode;
  }
  for (const key of ["buySlippagePercent", "sellSlippagePercent"]) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value < SLIPPAGE_MIN || value > SLIPPAGE_MAX) throw new TradingError(`Slippage must be between ${SLIPPAGE_MIN}% and ${SLIPPAGE_MAX}%.`);
    set[key] = value;
  }

  if (patch.tradeDelaySeconds !== undefined) {
    const seconds = Number(patch.tradeDelaySeconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_TRADE_DELAY_SECONDS) throw new TradingError(`The wait before a trade must be between 0 and ${MAX_TRADE_DELAY_SECONDS} seconds.`);
    set.tradeDelaySeconds = Math.round(seconds * 10) / 10;
  }

  if (patch.sendMode !== undefined) {
    if (patch.sendMode !== "raw" && patch.sendMode !== "jito") throw new TradingError("Send mode must be 'raw' or 'jito'.");
    set.sendMode = patch.sendMode;
  }
  if (patch.jitoTipUsd !== undefined) {
    if (patch.jitoTipUsd === null) set.jitoTipUsd = null;
    else {
      const tip = Number(patch.jitoTipUsd);
      if (!Number.isFinite(tip) || tip < 0 || tip > MAX_TIP_USD) throw new TradingError(`The Jito tip must be between $0 and $${MAX_TIP_USD}.`);
      set.jitoTipUsd = tip;
    }
  }
  if (patch.rawPriorityMicroLamports !== undefined) {
    const fee = Number(patch.rawPriorityMicroLamports);
    if (!Number.isFinite(fee) || fee < 0 || fee > MAX_PRIORITY_MICRO_LAMPORTS) throw new TradingError(`The priority fee must be between 0 and ${MAX_PRIORITY_MICRO_LAMPORTS} micro-lamports per compute unit.`);
    set.rawPriorityMicroLamports = Math.floor(fee);
  }
  for (const key of ["tradeRatioSim", "tradeRatioLive"]) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value < RATIO_MIN || value > RATIO_MAX) throw new TradingError(`The trade-size ratio numbers must be between ${RATIO_MIN} and ${RATIO_MAX}.`);
    set[key] = value;
  }
  if (patch.scaleJitoFee !== undefined) {
    if (typeof patch.scaleJitoFee !== "boolean") throw new TradingError("Scaling must be on or off.");
    set.scaleJitoFee = patch.scaleJitoFee;
  }
  if (patch.paused !== undefined) {
    if (typeof patch.paused !== "boolean") throw new TradingError("Paused must be true or false.");
    set.paused = patch.paused;
  }

  if (patch.tradingMode !== undefined) {
    if (patch.tradingMode !== "dry" && patch.tradingMode !== "live") throw new TradingError("Mode must be 'dry' or 'live'.");
    if (patch.tradingMode === "live" && live.tradingMode !== "live") {
      const connected = set.connectedWalletId ?? live.connectedWalletId;
      if (!connected) throw new TradingError("Connect a simulation wallet first.");
      if (!isWalletEncryptionConfigured()) throw new TradingError("WALLET_ENCRYPTION_KEY isn't set on the server.", 503);
      // Real money: a fresh authenticator code, every time.
      const check = await verifyTwoFactorStepUp(userId, String(code ?? "").trim().slice(0, 12), { ip });
      if (!check.ok) {
        logEvent("tracker", `[live-wallet] Failed attempt to switch "${live.name}" to live trading by ${username}`, { level: "warn", meta: { walletId: String(live._id), reason: check.error } });
        throw new TradingError(check.error, check.status);
      }
    }
    set.tradingMode = patch.tradingMode;
  }

  if (Object.keys(set).length === 0) return getTradingState(liveId);
  try {
    await LiveWallet.updateOne({ _id: live._id }, { $set: set });
  } catch (err) {
    if (err?.code === 11000) throw new TradingError("That simulation wallet is already connected to another live wallet.", 409);
    throw err;
  }
  const show = (v) => (v instanceof Date ? "now" : typeof v === "object" && v !== null ? JSON.stringify(v) : v);
  const changes = Object.entries(set).map(([k, v]) => `${k}=${show(v)}`).join(", ");
  logEvent("tracker", `[live-wallet] "${live.name}" trading settings changed by ${username}: ${changes}`, { level: set.tradingMode === "live" ? "warn" : "info", meta: { walletId: String(live._id), ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, String(show(v))])) } });
  return getTradingState(liveId);
}

/** Runs the burn engine for this wallet now (it also runs by itself every 30 minutes). */
export async function burnEmptyNow(liveId) {
  const live = await LiveWallet.findById(liveId, { connectedWalletId: 1, tradingMode: 1 }).lean();
  if (!live) throw new TradingError("Wallet not found", 404);
  if (!live.connectedWalletId || live.tradingMode !== "live") throw new TradingError("The burn engine only works on a wallet that is connected and trading live.", 409);
  const result = await sweepWallet(liveId);
  if (!result) throw new TradingError("A sweep of this wallet is already running.", 409);
  return result;
}

// ------------------------------------------------------------------ lots, side by side

const SIM_LOOKUP = {
  $lookup: {
    from: "walletpositions",
    let: { w: "$walletId", t: "$traderAddress", m: "$mint" },
    pipeline: [
      { $match: { $expr: { $and: [{ $eq: ["$walletId", "$$w"] }, { $eq: ["$traderAddress", "$$t"] }, { $eq: ["$mint", "$$m"] }] } } },
      { $project: { status: 1, tokenAmount: 1, costBasisUsd: 1, buyFeeUsd: 1, buyPriceUsd: 1, openedAt: 1, closedAt: 1, closeReason: 1, sellPriceUsd: 1, proceedsUsd: 1, sellFeeUsd: 1, realizedPnlUsd: 1, realizedPnlPercent: 1 } },
    ],
    as: "sim",
  },
};

function simSide(position) {
  if (!position) return null;
  const cost = (position.costBasisUsd || 0) + (position.buyFeeUsd || 0);
  const closed = position.status === "closed";
  return {
    status: position.status,
    openedAt: position.openedAt,
    closedAt: position.closedAt,
    closeReason: position.closeReason,
    costUsd: cost,
    buyPriceUsd: position.buyPriceUsd,
    sellPriceUsd: position.sellPriceUsd,
    tokenAmount: position.tokenAmount,
    proceedsUsd: closed ? (position.proceedsUsd || 0) - (position.sellFeeUsd || 0) : null,
    pnlUsd: closed ? position.realizedPnlUsd : null,
    pnlPercent: closed ? position.realizedPnlPercent : null,
  };
}

function liveSide(lot) {
  const closed = lot.status === "closed";
  const buy = lot.buy;
  return {
    mode: lot.mode,
    verified: !!buy.verified,
    venue: buy.venue,
    tokenAmount: Number(lot.tokenRaw) / 10 ** (lot.decimals ?? 6),
    costUsd: buyCostUsd(buy),
    buyPriceUsd: buy.priceUsd,
    swapSol: buy.swapLamports / LAMPORTS,
    route: buy.route ?? null,
    sendMode: buy.sendMode ?? null,
    assumedTipUsd: (((buy.assumedTipLamports || 0) + (lot.sell?.assumedTipLamports || 0)) / LAMPORTS) * (buy.solUsd || 0),
    tipUsd: ((buy.tipLamports || 0) / LAMPORTS) * (buy.solUsd || 0),
    feeUsd: ((buy.feeLamports || 0) / LAMPORTS) * (buy.solUsd || 0),
    rentSol: (buy.rentLamports || 0) / LAMPORTS,
    // The exact moments of the two legs (a dry run's are when it priced them), for comparing with the simulation's.
    boughtAt: buy.at ?? lot.openedAt,
    soldAt: closed ? (lot.sell?.at ?? lot.closedAt) : null,
    buySignature: buy.signature,
    sellSignature: lot.sell?.signature ?? null,
    sellPriceUsd: lot.sell?.priceUsd ?? null,
    proceedsUsd: closed ? lot.proceedsUsd : null,
    pnlUsd: closed ? lot.realizedPnlUsd : null,
    pnlPercent: closed ? lot.realizedPnlPercent : null,
    sellTipUsd: lot.sell ? ((lot.sell.tipLamports || 0) / LAMPORTS) * (lot.sell.solUsd || 0) : null,
    sellFeeUsd: lot.sell ? ((lot.sell.feeLamports || 0) / LAMPORTS) * (lot.sell.solUsd || 0) : null,
  };
}

const dryView = (exit) => (exit ? { reason: exit.reason, at: exit.at, priceUsd: exit.priceUsd, proceedsUsd: exit.proceedsUsd, pnlUsd: exit.realizedPnlUsd, pnlPercent: exit.realizedPnlPercent } : null);

/**
 * One page of the live wallet's lots with the simulation's matching position beside each.
 * @param {string} liveId
 * @param {{ status?: "open" | "closed" | null, page?: number, limit?: number }} [options]
 */
export async function listLots(liveId, { status = null, page = 1, limit = 25 } = {}) {
  if (!mongoose.isValidObjectId(liveId)) return null;
  const id = new mongoose.Types.ObjectId(liveId);
  const match = { liveWalletId: id, ...(status === "open" || status === "closed" ? { status } : {}) };
  const pageSize = Math.min(100, Math.max(1, Math.floor(limit) || 25));
  const pageNo = Math.max(1, Math.floor(page) || 1);

  const [total, rows] = await Promise.all([
    LiveLot.countDocuments(match),
    LiveLot.aggregate([{ $match: match }, { $sort: { openedAt: -1, _id: -1 } }, { $skip: (pageNo - 1) * pageSize }, { $limit: pageSize }, SIM_LOOKUP]),
  ]);

  const open = rows.filter((r) => r.status === "open");
  if (open.length) await prefetchPrices(open.map((r) => r.mint), { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP }).catch(() => {});
  const meta = await getTokenMeta([...new Set(rows.map((r) => r.mint))]);

  const lots = await Promise.all(
    rows.map(async (lot) => {
      const m = meta.get(lot.mint);
      const live = liveSide(lot);
      const sim = simSide(lot.sim?.[0]);
      if (lot.status === "open") {
        const price = await getPrice(lot.mint, { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP }).catch(() => null);
        if (price?.priceUsd) {
          live.valueUsd = lotValueUsd(lot, price.priceUsd);
          live.unrealizedUsd = live.valueUsd - live.costUsd;
          live.unrealizedPercent = live.costUsd > 0 ? (live.unrealizedUsd / live.costUsd) * 100 : null;
          if (sim && sim.status === "open") {
            const value = sim.tokenAmount * price.priceUsd;
            sim.valueUsd = value;
            sim.unrealizedUsd = value - sim.costUsd;
            sim.unrealizedPercent = sim.costUsd > 0 ? (sim.unrealizedUsd / sim.costUsd) * 100 : null;
          }
        }
      }
      return {
        id: String(lot._id),
        status: lot.status,
        mode: lot.mode,
        traderAddress: lot.traderAddress,
        mint: lot.mint,
        symbol: m?.symbol ?? null,
        name: m?.name ?? null,
        icon: m?.icon ?? null,
        openedAt: lot.openedAt,
        closedAt: lot.closedAt,
        closeReason: lot.closeReason,
        live,
        sim,
        paired: !!sim,
        unpaired: !!lot.unpaired,
        // The simulation trades a different number of dollars when the wallet has a trade-size ratio: its dollars are multiplied by this to match.
        scale: lot.sizeScale ?? 1,
        sellFailure: lot.sellFailure ? { at: lot.sellFailure.at, reason: lot.sellFailure.reason, failures: lot.sellFailure.failures } : null,
        // What each exit style did (or null while it hasn't decided), in the order the wallet lists them.
        dry: lot.mode === "dry" ? Object.fromEntries(lotStyleIds(lot).map((id) => [id, dryView(lot.dryExits?.[id])])) : null,
        // live minus simulation, on the same trade (the simulation's dollars scaled to the live trade size)
        differenceUsd: live.pnlUsd != null && sim?.pnlUsd != null ? live.pnlUsd - sim.pnlUsd * (lot.sizeScale ?? 1) : null,
        differencePercent: live.pnlPercent != null && sim?.pnlPercent != null ? live.pnlPercent - sim.pnlPercent : null,
      };
    })
  );
  return { lots, total, page: pageNo, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

// ------------------------------------------------------------------ totals

/** Totals over every settled lot: live next to simulation on the very same trades, the costs, and the dry-run comparison of the two exit modes. */
export async function getTradingSummary(liveId) {
  if (!mongoose.isValidObjectId(liveId)) return null;
  const id = new mongoose.Types.ObjectId(liveId);
  const dryResetAt = (await LiveWallet.findById(id, { dryResetAt: 1 }).lean())?.dryResetAt ?? null;

  const [byStatus, closed, dryLots, daily] = await Promise.all([
    LiveLot.aggregate([{ $match: { liveWalletId: id } }, { $group: { _id: { mode: "$mode", status: "$status" }, n: { $sum: 1 } } }]),
    LiveLot.aggregate([
      { $match: { liveWalletId: id, status: "closed", mode: "live" } },
      SIM_LOOKUP,
      {
        $group: {
          _id: null,
          trades: { $sum: 1 },
          livePnlUsd: { $sum: "$realizedPnlUsd" },
          liveCostUsd: { $sum: "$costUsd" },
          liveWins: { $sum: { $cond: [{ $gt: ["$realizedPnlUsd", 0] }, 1, 0] } },
          tipLamportsUsd: { $sum: { $add: [{ $multiply: [{ $divide: [{ $add: ["$buy.tipLamports", { $ifNull: ["$sell.tipLamports", 0] }] }, LAMPORTS] }, { $ifNull: ["$buy.solUsd", 0] }] }] } },
          assumedTipsUsd: { $sum: { $multiply: [{ $divide: [{ $add: [{ $ifNull: ["$buy.assumedTipLamports", 0] }, { $ifNull: ["$sell.assumedTipLamports", 0] }] }, LAMPORTS] }, { $ifNull: ["$buy.solUsd", 0] }] } },
          feeLamportsUsd: { $sum: { $multiply: [{ $divide: [{ $add: ["$buy.feeLamports", { $ifNull: ["$sell.feeLamports", 0] }] }, LAMPORTS] }, { $ifNull: ["$buy.solUsd", 0] }] } },
          paired: { $sum: { $cond: [{ $gt: [{ $size: "$sim" }, 0] }, 1, 0] } },
          // The simulation's profit scaled to the live trade size (the wallet's ratio), so it can be compared with the live profit.
          simPnlUsd: { $sum: { $multiply: [{ $ifNull: [{ $arrayElemAt: ["$sim.realizedPnlUsd", 0] }, 0] }, { $ifNull: ["$sizeScale", 1] }] } },
          simWins: { $sum: { $cond: [{ $gt: [{ $ifNull: [{ $arrayElemAt: ["$sim.realizedPnlUsd", 0] }, 0] }, 0] }, 1, 0] } },
        },
      },
    ]),
    LiveLot.find({ liveWalletId: id, mode: "dry", ...(dryResetAt ? { openedAt: { $gte: dryResetAt } } : {}) }, { dryExits: 1, dryStyles: 1 }).lean(),
    LiveLot.aggregate([
      { $match: { liveWalletId: id, status: "closed", closedAt: { $ne: null } } },
      SIM_LOOKUP,
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$closedAt", timezone: "UTC" } },
          livePnlUsd: { $sum: "$realizedPnlUsd" },
          simPnlUsd: { $sum: { $multiply: [{ $ifNull: [{ $arrayElemAt: ["$sim.realizedPnlUsd", 0] }, 0] }, { $ifNull: ["$sizeScale", 1] }] } },
          trades: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const count = (mode, status) => byStatus.find((r) => r._id.mode === mode && r._id.status === status)?.n ?? 0;
  const c = closed[0];
  // The dry-run comparison: only trades every style has decided, so each style is judged on exactly the same entries.
  const decided = dryLots.filter((l) => lotStyleIds(l).every((sid) => l.dryExits?.[sid]));
  const styleIds = decided.length ? lotStyleIds(decided[0]) : [];
  const live = await LiveWallet.findById(id, { cooldownStyles: 1 }).lean();
  const cooldowns = cooldownStylesOf(live ?? {});
  let liveRunning = 0;
  let simRunning = 0;
  const series = daily.map((row) => {
    liveRunning += row.livePnlUsd;
    simRunning += row.simPnlUsd;
    return { date: row._id, livePnlUsd: liveRunning, simPnlUsd: simRunning, trades: row.trades };
  });

  return {
    live: { open: count("live", "open"), closed: count("live", "closed") },
    dry: { open: count("dry", "open"), closed: count("dry", "closed") },
    dryResetAt,
    settled: c
      ? {
          trades: c.trades,
          livePnlUsd: c.livePnlUsd,
          simPnlUsd: c.simPnlUsd,
          pairedTrades: c.paired,
          liveWinRate: c.trades ? (c.liveWins / c.trades) * 100 : null,
          simWinRate: c.paired ? (c.simWins / c.paired) * 100 : null,
          tipsPaidUsd: c.tipLamportsUsd,
          assumedTipsUsd: c.assumedTipsUsd,
          networkFeesPaidUsd: c.feeLamportsUsd,
        }
      : null,
    dryComparison: decided.length
      ? {
          trades: decided.length,
          styles: styleIds.map((sid) => {
            const pnls = decided.map((l) => l.dryExits[sid].realizedPnlUsd ?? 0);
            return { id: sid, label: styleLabel(sid, cooldowns), pnlUsd: pnls.reduce((a, b) => a + b, 0), winRate: (pnls.filter((p) => p > 0).length / pnls.length) * 100 };
          }),
        }
      : null,
    series,
  };
}

/**
 * "Reset dry run": from now on the exit-style comparison and the day-by-day results count only the dry trades opened after this moment, so every
 * style starts again from zero on the same fresh entries. Nothing is deleted - the trades stay in the list, and positions still open keep being worked.
 */
export async function resetDryRun(liveId) {
  if (!mongoose.isValidObjectId(liveId)) throw new TradingError("Wallet not found", 404);
  const live = await LiveWallet.findByIdAndUpdate(liveId, { $set: { dryResetAt: new Date() } }, { returnDocument: "after", projection: { dryResetAt: 1 } }).lean();
  if (!live) throw new TradingError("Wallet not found", 404);
  logEvent("trade", `[live] Dry run reset for live wallet ${liveId}: the exit styles start again from zero`, { meta: { liveWalletId: String(liveId) } });
  return { dryResetAt: live.dryResetAt };
}

const DAILY_DAYS = 7;

/**
 * What each exit style made per day (UTC) over the last 7 days, in dollars: a style's result counts on the day IT decided (sold), whatever the other
 * styles did with the same entry. Only dry trades opened since the last reset are counted.
 */
export async function getDryDaily(liveId) {
  if (!mongoose.isValidObjectId(liveId)) return null;
  const id = new mongoose.Types.ObjectId(liveId);
  const live = await LiveWallet.findById(id, { cooldownStyles: 1, dryResetAt: 1 }).lean();
  if (!live) return null;

  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const days = Array.from({ length: DAILY_DAYS }, (_, i) => dayKey(Date.now() - (DAILY_DAYS - 1 - i) * 86_400_000));
  // A trade can be opened days before its exit; two weeks back covers any realistic max hold.
  const from = new Date(Math.max(Date.now() - 14 * 86_400_000, live.dryResetAt ? new Date(live.dryResetAt).getTime() : 0));
  const lots = await LiveLot.find({ liveWalletId: id, mode: "dry", openedAt: { $gte: from } }, { dryExits: 1, dryStyles: 1 }).lean();

  const cooldowns = cooldownStylesOf(live);
  const ids = new Set(["own", "follow", ...cooldowns.map((c) => c.id)]);
  for (const lot of lots) for (const sid of lotStyleIds(lot)) ids.add(sid);

  const styles = [...ids].map((sid) => {
    const byDay = Object.fromEntries(days.map((d) => [d, { pnlUsd: 0, trades: 0, wins: 0 }]));
    for (const lot of lots) {
      const exit = lot.dryExits?.[sid];
      if (!exit?.at) continue;
      const bucket = byDay[dayKey(exit.at)];
      if (!bucket) continue;
      const pnl = exit.realizedPnlUsd ?? 0;
      bucket.pnlUsd += pnl;
      bucket.trades += 1;
      if (pnl > 0) bucket.wins += 1;
    }
    const rows = days.map((d) => ({ date: d, ...byDay[d] }));
    return { id: sid, label: styleLabel(sid, cooldowns), days: rows, totalUsd: rows.reduce((a, r) => a + r.pnlUsd, 0), trades: rows.reduce((a, r) => a + r.trades, 0) };
  });
  return { days, styles, dryResetAt: live.dryResetAt ?? null };
}

// ------------------------------------------------------------------ from the simulation wallet's side

/** The live wallet connected to a simulation wallet (if any) with its balance and how its copied trades did - for the simulation wallet's page. */
export async function getLinkedLive(simWalletId) {
  if (!mongoose.isValidObjectId(simWalletId)) return null;
  const live = await LiveWallet.findOne({ connectedWalletId: simWalletId }).lean();
  if (!live) return null;
  const [summary, chain] = await Promise.all([getTradingSummary(live._id), getChainSnapshot(live.address).catch(() => null)]);
  return {
    live: { _id: String(live._id), name: live.name, address: live.address, tradingMode: live.tradingMode, exitMode: live.exitMode },
    balance: chain ? { solBalance: chain.solBalance, totalValueUsd: chain.totalValueUsd } : null,
    summary,
  };
}

// ------------------------------------------------------------------ stats, and selling a stuck position by hand

/** The transaction stats (speed, successes, failures, retries) of one live wallet. */
export function getTradingStats(liveId, options) {
  return getTxStats(liveId, options);
}

/**
 * "Sell now": queues a sell of one open live position, for a sell that gave up (or any time). It is an ordinary sell - same route, same retries -
 * so it can only ever sell this lot's own tokens.
 */
export async function sellLotNow(liveId, lotId) {
  if (!mongoose.isValidObjectId(liveId) || !mongoose.isValidObjectId(lotId)) throw new TradingError("Position not found", 404);
  const lot = await LiveLot.findOne({ _id: lotId, liveWalletId: liveId });
  if (!lot) throw new TradingError("Position not found", 404);
  if (lot.status !== "open") throw new TradingError("This position is already closed.", 409);
  if (lot.mode !== "live") throw new TradingError("This is a dry-run position; there is nothing to sell.", 409);
  try {
    await LiveExecution.create({
      liveWalletId: lot.liveWalletId,
      walletId: lot.walletId,
      traderAddress: lot.traderAddress,
      mint: lot.mint,
      action: "sell",
      closeReason: "manual",
      track: null,
      triggerAt: new Date(),
      sourceSignature: `manual:${lot._id}`,
      idemKey: `manual:${lot._id}:${Date.now()}`,
    });
  } catch (err) {
    if (err?.code === 11000) throw new TradingError("A sell of this position is already waiting.", 409);
    throw err;
  }
  logEvent("trade", `[live] Manual sell queued for ${lot.mint} (trader ${lot.traderAddress})`, { meta: { liveWalletId: String(liveId), mint: lot.mint } });
  return { queued: true };
}

/** Number of open live positions whose sell gave up, per live wallet - for the wallet list. */
export async function stuckSellCounts() {
  const rows = await LiveLot.aggregate([{ $match: { status: "open", mode: "live", sellFailure: { $ne: null } } }, { $group: { _id: "$liveWalletId", n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

// ------------------------------------------------------------------ the lookup table

const TABLE_CREATE_MIN_SOL = 0.001; // a small floor to create the table: the chain refuses the transaction itself if the rent is not there
const TABLE_UPDATE_MIN_SOL = 0.005; // topping up an existing table
let creatingTable = new Set();

/** The wallet's lookup table: its address and how many accounts it holds, or nulls when it has none yet. */
export async function getTableInfo(live) {
  const table = live.lookupTable ? await loadWalletTable(live).catch(() => null) : null;
  return { address: live.lookupTable ?? null, addresses: table ? table.state.addresses.length : null };
}

/**
 * "Create lookup table": makes the wallet's table now (or tops it up) so the first trade doesn't have to. Spends about 0.01-0.02 SOL of rent from
 * the wallet (refundable by closing the table later) plus a few network fees. Needs two-factor turned on, like every change to what a wallet trades.
 */
export async function createLookupTable(liveId, { userId, username }) {
  if (!(await isTwoFactorEnabled(userId))) throw new TradingError("Two-factor sign-in must be turned on (Account page) before this wallet can spend on a lookup table.", 403);
  if (!isWalletEncryptionConfigured()) throw new TradingError("WALLET_ENCRYPTION_KEY isn't set on the server.", 503);
  const live = await LiveWallet.findById(liveId).select("+encryptedSecret");
  if (!live) throw new TradingError("Wallet not found", 404);
  if (creatingTable.has(String(live._id))) throw new TradingError("The lookup table is already being created.", 409);
  const lamports = (await rpc("getBalance", [live.address, { commitment: "confirmed" }])).value;
  const minSol = live.lookupTable ? TABLE_UPDATE_MIN_SOL : TABLE_CREATE_MIN_SOL;
  if (lamports / LAMPORTS < minSol) throw new TradingError(`The wallet needs at least ${minSol} SOL to ${live.lookupTable ? "update" : "create"} the table (it has ${(lamports / LAMPORTS).toFixed(4)}).`, 409);

  creatingTable.add(String(live._id));
  const secret = base58Decode(decryptWalletSecret(live.address, live.encryptedSecret));
  try {
    if (secret.length !== 64 || base58Encode(secret.subarray(32)) !== live.address) throw new TradingError("The stored key doesn't match the live wallet.", 500);
    const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
    const conn = new Connection(await pickRpcUrl(), "confirmed");
    const solUsd = await getSolUsd();
    const budgetLamports = BigInt(Math.floor((1 / solUsd) * LAMPORTS)); // any small amount: only the accounts matter
    // Recent tokens the simulation has traded are the samples (so they are tokens that really trade).
    const recent = await WalletPosition.aggregate([{ $sort: { openedAt: -1 } }, { $limit: 600 }, { $group: { _id: "$mint", at: { $first: "$openedAt" } } }, { $sort: { at: -1 } }, { $limit: 80 }]);
    const result = await createWalletTable({
      keypair,
      live,
      pumpSdks,
      sampleMints: recent.map((r) => r._id),
      resolveKind: async (mint) => {
        const m = await resolveMarket(conn, mint);
        return m.quote ? `quote:${m.quote.mint.toBase58()}` : m.venue;
      },
      buildBuy: async (mint) => (await prepareBuy({ owner: keypair.publicKey, mint, budgetLamports, slippagePercent: 15, solUsd, payWithSol: true, conn })).instructions,
    });
    logEvent("tracker", `[live-wallet] "${live.name}": lookup table created/updated by ${username}: ${result.address} (${result.total} addresses, +${result.added})`, { meta: { walletId: String(live._id), ...result, samples: result.samples.join(",") } });
    return result;
  } finally {
    secret.fill(0);
    creatingTable.delete(String(live._id));
  }
}
