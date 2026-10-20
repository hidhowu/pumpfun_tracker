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

  const warnings = [];
  if (sim && (sim.settings.jitoFeeUsd ?? 0) <= 0) warnings.push("The simulation wallet's Jito fee is $0, so transactions are tipped only Jito's minimum (about $0.0002) and will rarely land fast. Set a Jito fee on the simulation wallet.");
  if (paused) warnings.push("New buys are paused by the kill switch.");
  if (!isWalletEncryptionConfigured()) warnings.push("WALLET_ENCRYPTION_KEY isn't set on the server, so the wallet's key can't be used to trade.");

  return {
    connected: !!sim,
    tradingMode: live.tradingMode,
    exitMode: live.exitMode,
    buySlippagePercent: live.buySlippagePercent,
    sellSlippagePercent: live.sellSlippagePercent,
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
 * @param {{ connectedWalletId?: string | null, tradingMode?: "dry" | "live", exitMode?: "own" | "follow", buySlippagePercent?: number, sellSlippagePercent?: number }} patch
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

  if (patch.exitMode !== undefined) {
    if (patch.exitMode !== "own" && patch.exitMode !== "follow") throw new TradingError("Exit rules must be 'own' or 'follow'.");
    set.exitMode = patch.exitMode;
  }
  for (const key of ["buySlippagePercent", "sellSlippagePercent"]) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value < SLIPPAGE_MIN || value > SLIPPAGE_MAX) throw new TradingError(`Slippage must be between ${SLIPPAGE_MIN}% and ${SLIPPAGE_MAX}%.`);
    set[key] = value;
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
  const changes = Object.entries(set).map(([k, v]) => `${k}=${v instanceof Date ? "now" : v}`).join(", ");
  logEvent("tracker", `[live-wallet] "${live.name}" trading settings changed by ${username}: ${changes}`, { level: set.tradingMode === "live" ? "warn" : "info", meta: { walletId: String(live._id), ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, String(v)])) } });
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
    tipUsd: ((buy.tipLamports || 0) / LAMPORTS) * (buy.solUsd || 0),
    feeUsd: ((buy.feeLamports || 0) / LAMPORTS) * (buy.solUsd || 0),
    rentSol: (buy.rentLamports || 0) / LAMPORTS,
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
        dry: lot.mode === "dry" ? { own: dryView(lot.dryExits?.own), follow: dryView(lot.dryExits?.follow) } : null,
        // live minus simulation, on the same trade
        differenceUsd: live.pnlUsd != null && sim?.pnlUsd != null ? live.pnlUsd - sim.pnlUsd : null,
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

  const [byStatus, closed, dry, daily] = await Promise.all([
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
          feeLamportsUsd: { $sum: { $multiply: [{ $divide: [{ $add: ["$buy.feeLamports", { $ifNull: ["$sell.feeLamports", 0] }] }, LAMPORTS] }, { $ifNull: ["$buy.solUsd", 0] }] } },
          paired: { $sum: { $cond: [{ $gt: [{ $size: "$sim" }, 0] }, 1, 0] } },
          simPnlUsd: { $sum: { $ifNull: [{ $arrayElemAt: ["$sim.realizedPnlUsd", 0] }, 0] } },
          simWins: { $sum: { $cond: [{ $gt: [{ $ifNull: [{ $arrayElemAt: ["$sim.realizedPnlUsd", 0] }, 0] }, 0] }, 1, 0] } },
        },
      },
    ]),
    LiveLot.aggregate([
      { $match: { liveWalletId: id, mode: "dry", "dryExits.own": { $ne: null }, "dryExits.follow": { $ne: null } } },
      { $group: { _id: null, trades: { $sum: 1 }, ownPnlUsd: { $sum: "$dryExits.own.realizedPnlUsd" }, followPnlUsd: { $sum: "$dryExits.follow.realizedPnlUsd" }, ownWins: { $sum: { $cond: [{ $gt: ["$dryExits.own.realizedPnlUsd", 0] }, 1, 0] } }, followWins: { $sum: { $cond: [{ $gt: ["$dryExits.follow.realizedPnlUsd", 0] }, 1, 0] } } } },
    ]),
    LiveLot.aggregate([
      { $match: { liveWalletId: id, status: "closed", closedAt: { $ne: null } } },
      SIM_LOOKUP,
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$closedAt", timezone: "UTC" } },
          livePnlUsd: { $sum: "$realizedPnlUsd" },
          simPnlUsd: { $sum: { $ifNull: [{ $arrayElemAt: ["$sim.realizedPnlUsd", 0] }, 0] } },
          trades: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const count = (mode, status) => byStatus.find((r) => r._id.mode === mode && r._id.status === status)?.n ?? 0;
  const c = closed[0];
  const d = dry[0];
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
    settled: c
      ? {
          trades: c.trades,
          livePnlUsd: c.livePnlUsd,
          simPnlUsd: c.simPnlUsd,
          pairedTrades: c.paired,
          liveWinRate: c.trades ? (c.liveWins / c.trades) * 100 : null,
          simWinRate: c.paired ? (c.simWins / c.paired) * 100 : null,
          tipsPaidUsd: c.tipLamportsUsd,
          networkFeesPaidUsd: c.feeLamportsUsd,
        }
      : null,
    dryComparison: d ? { trades: d.trades, ownPnlUsd: d.ownPnlUsd, followPnlUsd: d.followPnlUsd, ownWinRate: (d.ownWins / d.trades) * 100, followWinRate: (d.followWins / d.trades) * 100 } : null,
    series,
  };
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
