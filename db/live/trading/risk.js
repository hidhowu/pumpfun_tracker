import { LiveWallet } from "../../models/LiveWallet.js";
import { LiveLot } from "../../models/LiveLot.js";
import { LiveExecution } from "../../models/LiveExecution.js";
import { Wallet } from "../../models/Wallet.js";
import { Trader } from "../../models/Trader.js";
import { WalletPosition } from "../../models/WalletPosition.js";
import { findUnpaired } from "./pairing.js";
import { getPrice, prefetchPrices, PRICE_MAX_AGE } from "../../pumpFunApi.js";
import { logEvent } from "../../systemLog.js";
import { buyCostUsd, lotValueUsd } from "./lots.js";
import { buildTrigger, confirmExit } from "../../simulation/exitTrigger.js";
import { cooldownStylesOf, lotStyleIds, selectedStyleId } from "./styles.js";

/**
 * The live wallet's OWN exit rules: stop-loss, take-profit, max hold time and trailing stops, judged against what each live position really
 * cost (not against the simulated position, whose entry price is a little different). The rules and their values are the simulation
 * wallet's own settings - same wording, same arithmetic as db/simulation/walletExecutor.js's checkWalletRiskExits:
 *   gain/loss % = (current value - cost) / cost, where the cost includes the swap, the tip and the network fee.
 *
 * The rules come in styles (db/live/trading/styles.js): "own", and the cool-down styles - which are "own" except that for a while after the buy only a deep
 * stop-loss, a take-profit, the max hold time or a positive trailing stop (exit level above 0%) can sell the position; negative trailing stops wait. "follow" is not judged here: the
 * simulation's exits are copied by db/live/trading/mirror.js - except for a trade the simulation never took (see markUnpaired), which has no exits to copy
 * and is judged by the "own" rules instead.
 *
 * Who is checked: a live lot of a wallet set to a style that judges exits itself, and every dry-run lot, once for each of its styles that has not decided yet.
 * A dry lot closes when the style the wallet is set to has decided, but goes on being checked here until the others have decided too (so they can be
 * compared). The profile's max trade time ends every style at the latest, so nothing is tracked beyond it (plus TRACK_GRACE_MS for the last sells to be
 * recorded); a profile with no max trade time has no such end. A trader that was blacklisted is exited whatever the setting.
 */

const TRACK_GRACE_MS = 5 * 60_000;

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

const HEAL_AFTER_MS = 30_000; // a simulated exit gets this long to reach its dry lot the normal way first

/**
 * A dry lot whose simulated position has closed but whose "follow" way was never recorded: its sell ran out of retries (no route to SOL at the time, the
 * RPC down, ...) and nothing queues it again, so the lot would wait for ever. Queues it again, the way the simulation exited.
 * @returns {Promise<number>} how many sells were queued
 */
async function requeueMissedFollowExits(lots) {
  const waiting = lots.filter((l) => l.mode === "dry" && lotStyleIds(l).includes("follow") && !l.dryExits?.follow);
  if (waiting.length === 0) return 0;
  const closed = await WalletPosition.find(
    { status: "closed", closeReason: { $ne: null }, closedAt: { $lte: new Date(Date.now() - HEAL_AFTER_MS) }, walletId: { $in: waiting.map((l) => l.walletId) }, mint: { $in: waiting.map((l) => l.mint) } },
    { walletId: 1, traderAddress: 1, mint: 1, openedAt: 1, closeReason: 1 }
  ).lean();
  let queued = 0;
  for (const lot of waiting) {
    // The simulated position opens a moment after its dry lot (the lot has no execution delay).
    const position = closed.find(
      (p) => String(p.walletId) === String(lot.walletId) && p.traderAddress === lot.traderAddress && p.mint === lot.mint && p.openedAt >= lot.openedAt - 30_000 && p.openedAt <= lot.openedAt.getTime() + 180_000
    );
    if (!position) continue;
    // A trader's sell and a blacklisting settle every way at once; every other exit is only the "follow" way.
    const all = position.closeReason === "trader_sell" || position.closeReason === "blacklisted";
    if (await queueSell(lot, position.closeReason, all ? null : "follow")) queued += 1;
  }
  return queued;
}

const PAIRING_GRACE_MS = 20_000; // the simulation's own buy is queued at the same moment and fills a few seconds later

/**
 * Finds the lots the simulation never took (its buy was skipped - e.g. pump.fun's trades API had no trade for a brand-new token yet - or its balance ran out)
 * and marks them `unpaired`: there is no simulated exit to follow for them, so "follow" is judged by the own-entry rules instead. Here that is a
 * LIVE lot of a wallet set to follow; a dry lot's "follow" copies its "own" exit at the moment that is recorded (executeDrySell in executor.js).
 */
async function markUnpaired(lots, lives) {
  const candidates = lots.filter(
    (l) => l.mode !== "dry" && !l.unpaired && Date.now() - l.openedAt.getTime() >= PAIRING_GRACE_MS && selectedStyleId(lives.get(String(l.liveWalletId)) ?? {}) === "follow"
  );
  const unpaired = await findUnpaired(candidates);
  if (unpaired.length === 0) return;
  await LiveLot.updateMany({ _id: { $in: unpaired.map((l) => l._id) } }, { $set: { unpaired: true } });
  for (const lot of unpaired) lot.unpaired = true;
}

/** Is the lot still being worked on: an open position, or a closed dry one whose other styles have not all decided yet (within the profile's max trade time)? */
const tracking = (lot, sim) => {
  if (lot.status === "open") return true;
  if (lot.mode !== "dry" || lot.dryDone !== false) return false;
  const maxSeconds = sim?.settings?.maxTradeTimeSeconds;
  return !(maxSeconds > 0) || Date.now() - lot.openedAt.getTime() < maxSeconds * 1000 + TRACK_GRACE_MS;
};

export async function checkLiveRiskExits() {
  const all = await LiveLot.find({ $or: [{ status: "open" }, { mode: "dry", dryDone: false }] });
  if (all.length === 0) return 0;

  const liveIds = [...new Set(all.map((l) => String(l.liveWalletId)))];
  const lives = new Map((await LiveWallet.find({ _id: { $in: liveIds } }, { connectedWalletId: 1, exitMode: 1, cooldownStyles: 1 }).lean()).map((w) => [String(w._id), w]));
  const sims = new Map();
  for (const live of lives.values()) {
    if (live.connectedWalletId) sims.set(String(live._id), await Wallet.findById(live.connectedWalletId, { settings: 1 }).lean());
  }
  // A closed dry lot that has been waited for past the profile's max trade time stops being tracked.
  const expired = all.filter((l) => l.status === "closed" && !tracking(l, sims.get(String(l.liveWalletId))));
  if (expired.length) await LiveLot.updateMany({ _id: { $in: expired.map((l) => l._id) } }, { $set: { dryDone: true } });
  const lots = all.filter((l) => tracking(l, sims.get(String(l.liveWalletId))));
  if (lots.length === 0) return 0;
  await markUnpaired(lots, lives).catch((err) => logEvent("trade", `[live] Couldn't check which trades the simulation took: ${err instanceof Error ? err.message : err}`, { level: "warn" }));
  const blacklisted = new Set((await Trader.find({ address: { $in: [...new Set(lots.map((l) => l.traderAddress))] }, status: "blacklisted" }, { address: 1 }).lean()).map((t) => t.address));

  await prefetchPrices(lots.map((l) => l.mint), { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });

  let queued = await requeueMissedFollowExits(lots).catch((err) => {
    logEvent("trade", `[live] Couldn't re-queue missed dry-run exits: ${err instanceof Error ? err.message : err}`, { level: "warn" });
    return 0;
  });
  await Promise.all(
    lots.map(async (lot) => {
      const live = lives.get(String(lot.liveWalletId));
      const sim = sims.get(String(lot.liveWalletId));
      if (!live || !sim) return;
      const dry = lot.mode === "dry";

      // The styles this sweep judges for this lot: a live lot only the one the wallet is set to; a dry lot each one that has not decided. "follow" copies the
      // simulation's exits (mirror.js); for a trade the simulation never took it has none to copy and takes the "own" exit (executeDrySell): in a dry lot that
      // is handled there, and a live lot of a wallet set to follow is judged here by the own-entry rules.
      const cooldowns = new Map(cooldownStylesOf(live).map((c) => [c.id, c]));
      const selected = selectedStyleId(live);
      const wanted = dry ? lotStyleIds(lot).filter((id) => !lot.dryExits?.[id] && id !== "follow") : selected === "follow" ? (lot.unpaired ? ["own"] : []) : [selected];
      const styles = wanted.map((id) => cooldowns.get(id) ?? (id === "own" || id === "follow" ? { id, kind: "own" } : null)).filter(Boolean);

      if (blacklisted.has(lot.traderAddress)) {
        // Settles every way at once. A dry lot that has already decided every style has nothing left to settle.
        if (!dry || lotStyleIds(lot).some((id) => !lot.dryExits?.[id])) if (await queueSell(lot, "blacklisted", null)) queued += 1;
        return;
      }
      if (styles.length === 0) return;

      const price = await getPrice(lot.mint, { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });
      if (!price?.priceUsd) return;
      const value = lotValueUsd(lot, price.priceUsd);
      const cost = buyCostUsd(lot.buy);
      if (!(cost > 0)) return;
      const percent = ((value - cost) / cost) * 100;
      const ageSeconds = (Date.now() - lot.openedAt.getTime()) / 1000;

      const peak = value > (lot.maxValueUsd ?? 0) ? { maxValueUsd: value } : null;
      const trough = lot.minValueUsd == null || value < lot.minValueUsd ? { minValueUsd: value } : null;
      if (peak || trough) await LiveLot.updateOne({ _id: lot._id }, { $set: { ...peak, ...trough } });

      const s = sim.settings;
      // What this sweep saw, kept with the exit (db/simulation/exitTrigger.js).
      const triggerFor = (kind, thresholdPercent, rule) =>
        buildTrigger(kind, { thresholdPercent, unrealizedPercent: percent, valueUsd: value, priceUsd: price.priceUsd, priceSource: price.source, rule });
      // Real money and no execution delay: a stop-loss / trailing stop is queued only if a fresh read agrees it is breached. (One fresh read serves every style.)
      let fresh = null;
      const freshValue = () =>
        (fresh ??= getPrice(lot.mint, { fresh: true }).then((now) => (now?.priceUsd ? lotValueUsd(lot, now.priceUsd) : null)));
      const confirmed = (trigger) => confirmExit(trigger, { totalCost: cost, valueNow: freshValue, meta: { liveWalletId: String(lot.liveWalletId), traderAddress: lot.traderAddress, mint: lot.mint } });

      // Trailing stops arm at the same price for every style, so it is done once. A rule that arms on this sweep is first judged on the next.
      const rules = s.trailingStops || [];
      const armedBefore = new Set((lot.armedTrailingStopIds || []).map(String));
      for (const rule of rules) {
        if (!armedBefore.has(String(rule._id)) && percent >= rule.armPercent) {
          await LiveLot.updateOne({ _id: lot._id }, { $addToSet: { armedTrailingStopIds: String(rule._id) } });
          logEvent("trade", `[live] Trailing-stop armed on ${lot.mint} for ${lot.traderAddress} at +${percent.toFixed(1)}% (exits at ${rule.exitPercent}%)`, { meta: { liveWalletId: String(lot.liveWalletId), mint: lot.mint } });
        }
      }

      /** The exit this style makes on this price, or null. */
      const judge = async (style) => {
        const coolingDown = style.kind === "cooldown" && ageSeconds < style.seconds;
        // Within the cool-down only the style's own deep stop applies; after it, the profile's.
        const stopLoss = coolingDown ? style.stopLossPercent : s.stopLossPercent;
        if (stopLoss != null && percent <= -Math.abs(stopLoss)) {
          const trigger = await confirmed(triggerFor("stop_loss", -Math.abs(stopLoss)));
          return trigger ? { reason: "stop_loss", trigger } : null;
        }
        if (s.takeProfitPercent != null && percent >= Math.abs(s.takeProfitPercent)) return { reason: "take_profit", trigger: triggerFor("take_profit", Math.abs(s.takeProfitPercent)) };
        if (s.maxTradeTimeSeconds > 0 && ageSeconds >= s.maxTradeTimeSeconds) return { reason: "max_hold_time", trigger: triggerFor("max_hold_time", null) };
        // Inside the cool-down only a positive trailing stop (one that exits above 0%, locking profit in) can fire; a negative one (a loss-side level) waits
        // until the cool-down is over. After that, a rule that is armed and whose level the price is now below sells; one the price dipped under and climbed
        // back from does not.
        for (const rule of rules) {
          if (coolingDown && rule.exitPercent < 0) continue;
          if (armedBefore.has(String(rule._id)) && percent <= rule.exitPercent) {
            const trigger = await confirmed(triggerFor("trailing_stop", rule.exitPercent, rule));
            return trigger ? { reason: "trailing_stop", trigger } : null;
          }
        }
        return null;
      };

      for (const style of styles) {
        const exit = await judge(style);
        if (exit && (await queueSell(lot, exit.reason, dry ? style.id : null, exit.trigger))) queued += 1;
      }
    })
  );
  return queued;
}
