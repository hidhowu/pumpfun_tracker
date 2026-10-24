import { LiveWallet } from "../../models/LiveWallet.js";
import { LiveLot } from "../../models/LiveLot.js";
import { LiveExecution } from "../../models/LiveExecution.js";
import { Wallet } from "../../models/Wallet.js";
import { Trader } from "../../models/Trader.js";
import { getPrice, prefetchPrices, PRICE_MAX_AGE } from "../../pumpFunApi.js";
import { logEvent } from "../../systemLog.js";
import { buyCostUsd, lotValueUsd } from "./lots.js";
import { buildTrigger, confirmExit } from "../../simulation/exitTrigger.js";

/**
 * The live wallet's OWN exit rules: stop-loss, take-profit, max hold time and trailing stops, judged against what each live position really
 * cost (not against the simulated position, whose entry price is a little different). The rules and their values are the simulation
 * wallet's own settings - same wording, same arithmetic as db/simulation/walletExecutor.js's checkWalletRiskExits:
 *   gain/loss % = (current value - cost) / cost, where the cost includes the swap, the tip and the network fee.
 *
 * Who is checked: a live lot of a wallet set to judge exits itself ("own"), and every dry-run lot (whose "own" way is recorded next to
 * the way that follows the simulation, so the two can be compared). A trader that was blacklisted is exited whatever the setting.
 */

async function queueSell(lot, closeReason, track, trigger = null) {
  try {
    await LiveExecution.create({
      liveWalletId: lot.liveWalletId,
      walletId: lot.walletId,
      traderAddress: lot.traderAddress,
      mint: lot.mint,
      action: "sell",
      closeReason,
      track,
      trigger,
      triggerAt: new Date(),
      sourceSignature: `exit:${closeReason}:${lot._id}`,
    });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false; // already queued
    throw err;
  }
}

export async function checkLiveRiskExits() {
  const lots = await LiveLot.find({ status: "open" });
  if (lots.length === 0) return 0;

  const liveIds = [...new Set(lots.map((l) => String(l.liveWalletId)))];
  const lives = new Map((await LiveWallet.find({ _id: { $in: liveIds } }, { connectedWalletId: 1, exitMode: 1 }).lean()).map((w) => [String(w._id), w]));
  const sims = new Map();
  for (const live of lives.values()) {
    if (live.connectedWalletId) sims.set(String(live._id), await Wallet.findById(live.connectedWalletId, { settings: 1 }).lean());
  }
  const blacklisted = new Set((await Trader.find({ address: { $in: [...new Set(lots.map((l) => l.traderAddress))] }, status: "blacklisted" }, { address: 1 }).lean()).map((t) => t.address));

  await prefetchPrices(lots.map((l) => l.mint), { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });

  let queued = 0;
  await Promise.all(
    lots.map(async (lot) => {
      const live = lives.get(String(lot.liveWalletId));
      const sim = sims.get(String(lot.liveWalletId));
      if (!live || !sim) return;
      const dry = lot.mode === "dry";
      // Which lots does this sweep judge? A live lot only when the wallet judges exits itself; a dry lot only until its own way has decided.
      const ownTrack = dry ? "own" : null;
      if (dry ? !!lot.dryExits?.own : live.exitMode !== "own") {
        if (!blacklisted.has(lot.traderAddress)) return;
      }

      if (blacklisted.has(lot.traderAddress)) {
        if (await queueSell(lot, "blacklisted", null)) queued += 1; // settles both ways in a dry run
        return;
      }

      const price = await getPrice(lot.mint, { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });
      if (!price?.priceUsd) return;
      const value = lotValueUsd(lot, price.priceUsd);
      const cost = buyCostUsd(lot.buy);
      if (!(cost > 0)) return;
      const percent = ((value - cost) / cost) * 100;

      const peak = value > (lot.maxValueUsd ?? 0) ? { maxValueUsd: value } : null;
      const trough = lot.minValueUsd == null || value < lot.minValueUsd ? { minValueUsd: value } : null;
      if (peak || trough) await LiveLot.updateOne({ _id: lot._id, status: "open" }, { $set: { ...peak, ...trough } });

      const s = sim.settings;
      // What this sweep saw, kept with the exit (db/simulation/exitTrigger.js).
      const triggerFor = (kind, thresholdPercent, rule) =>
        buildTrigger(kind, { thresholdPercent, unrealizedPercent: percent, valueUsd: value, priceUsd: price.priceUsd, priceSource: price.source, rule });
      // Real money and no execution delay: a stop-loss / trailing stop is queued only if a fresh read agrees it is breached.
      const confirmed = (trigger) =>
        confirmExit(trigger, {
          totalCost: cost,
          valueNow: async () => {
            const now = await getPrice(lot.mint, { fresh: true });
            return now?.priceUsd ? lotValueUsd(lot, now.priceUsd) : null;
          },
          meta: { liveWalletId: String(lot.liveWalletId), traderAddress: lot.traderAddress, mint: lot.mint },
        });
      const exit = async (reason, trigger) => {
        if (await queueSell(lot, reason, ownTrack, trigger)) queued += 1;
      };
      if (s.stopLossPercent != null && percent <= -Math.abs(s.stopLossPercent)) {
        const trigger = await confirmed(triggerFor("stop_loss", -Math.abs(s.stopLossPercent)));
        return trigger ? exit("stop_loss", trigger) : undefined;
      }
      if (s.takeProfitPercent != null && percent >= Math.abs(s.takeProfitPercent)) return exit("take_profit", triggerFor("take_profit", Math.abs(s.takeProfitPercent)));
      if (s.maxTradeTimeSeconds > 0 && (Date.now() - lot.openedAt.getTime()) / 1000 >= s.maxTradeTimeSeconds) return exit("max_hold_time", triggerFor("max_hold_time", null));

      const rules = s.trailingStops || [];
      if (rules.length > 0) {
        const armed = new Set((lot.armedTrailingStopIds || []).map(String));
        for (const rule of rules) {
          const id = String(rule._id);
          if (!armed.has(id)) {
            if (percent >= rule.armPercent) {
              await LiveLot.updateOne({ _id: lot._id, status: "open" }, { $addToSet: { armedTrailingStopIds: id } });
              logEvent("trade", `[live] Trailing-stop armed on ${lot.mint} for ${lot.traderAddress} at +${percent.toFixed(1)}% (exits at ${rule.exitPercent}%)`, { meta: { liveWalletId: String(lot.liveWalletId), mint: lot.mint } });
            }
          } else if (percent <= rule.exitPercent) {
            const trigger = await confirmed(triggerFor("trailing_stop", rule.exitPercent, rule));
            return trigger ? exit("trailing_stop", trigger) : undefined;
          }
        }
      }
    })
  );
  return queued;
}
