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
import { API_PLUS_STYLE, cooldownStylesOf, lotStyleIds, selectedStyleId } from "./styles.js";
import { tradeDelaySeconds } from "./settings.js";
import { INDEX_LAG_SEC, apiPlusIntervalSeconds, nextSampleAt, poolPriceAt } from "../../simulation/apiPlus.js";

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
const API_PLUS_MAX_CATCH_UP = 12; // check moments judged per lot per pass, if the daemon was away for a while

/*
 * A live wallet connected to an "api_plus" simulation wallet (Wallet.settings.trackingMethod) judges its own exit rules the way that wallet does
 * (db/simulation/apiPlus.js): not on the price right now but on the pool price, from the token's trade list, at the lot's check moments (the
 * lot's open + a fixed phase + k x the risk-check interval). Each sweep judges the newest moment that is old enough to be listed and has not been
 * judged yet, so a spike between two moments is never seen; there is no fresh re-check of a low reading, as in the backtest. The simulation wallet's
 * own positions are judged moment by moment (checkApiPlusExits). The live lots of such a wallet are swept by their own pass (checkLiveRiskExits({ apiPlus: true }),
 * every few seconds - see loops.js): it only looks for check moments that have become due, so the pass can run far more often than the interval, and a moment
 * is never lost to a slow pass - the lots are caught up moment by moment, in order.
 */

/** @param {number} [delaySeconds] the live wallet's wait before a trade (settings.js tradeDelaySeconds); a sell that is queued late anyway passes none */
async function queueSell(lot, closeReason, track, trigger = null, delaySeconds = 0) {
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
      triggerAt: new Date(Date.now() + delaySeconds * 1000),
      delaySeconds,
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

/**
 * The styles this sweep judges for a lot: a live lot only the one the wallet is set to; a dry lot each one that has not decided. "follow" copies the
 * simulation's exits (mirror.js); for a trade the simulation never took it has none to copy and takes the "own" exit (executeDrySell): in a dry lot that
 * is handled there, and a live lot of a wallet set to follow is judged here by the own-entry rules.
 */
function stylesFor(lot, live) {
  const cooldowns = new Map(cooldownStylesOf(live).map((c) => [c.id, c]));
  const selected = selectedStyleId(live);
  const wanted = lot.mode === "dry" ? lotStyleIds(lot).filter((id) => !lot.dryExits?.[id] && id !== "follow") : selected === "follow" ? (lot.unpaired ? ["own"] : []) : [selected];
  return wanted.map((id) => cooldowns.get(id) ?? (id === "own" || id === "follow" || id === API_PLUS_STYLE ? { id, kind: "own" } : null)).filter(Boolean);
}

/** A style is judged on sampled prices at the lot's check moments (the API Plus way) when its simulation wallet is "api_plus", or when it is the API Plus style itself. */
const sampledStyle = (style, sim) => sim.settings?.trackingMethod === "api_plus" || style.id === API_PLUS_STYLE;

/** @param {{ apiPlus?: boolean }} [options] apiPlus = judge only the styles that look at sampled prices (API Plus), every few seconds; otherwise all the other styles */
export async function checkLiveRiskExits({ apiPlus: apiPlusPass = false } = {}) {
  const all = await LiveLot.find({ $or: [{ status: "open" }, { mode: "dry", dryDone: false }] });
  if (all.length === 0) return 0;

  const liveIds = [...new Set(all.map((l) => String(l.liveWalletId)))];
  const lives = new Map((await LiveWallet.find({ _id: { $in: liveIds } }, { connectedWalletId: 1, exitMode: 1, cooldownStyles: 1, tradeDelaySeconds: 1 }).lean()).map((w) => [String(w._id), w]));
  const sims = new Map();
  for (const live of lives.values()) {
    if (live.connectedWalletId) sims.set(String(live._id), await Wallet.findById(live.connectedWalletId, { settings: 1 }).lean());
  }
  // A closed dry lot that has been waited for past the profile's max trade time stops being tracked.
  const expired = all.filter((l) => l.status === "closed" && !tracking(l, sims.get(String(l.liveWalletId))));
  if (expired.length) await LiveLot.updateMany({ _id: { $in: expired.map((l) => l._id) } }, { $set: { dryDone: true } });
  const tracked = all.filter((l) => tracking(l, sims.get(String(l.liveWalletId))));
  if (tracked.length === 0) return 0;
  // Bookkeeping over every tracked lot, once per normal sweep.
  if (!apiPlusPass) await markUnpaired(tracked, lives).catch((err) => logEvent("trade", `[live] Couldn't check which trades the simulation took: ${err instanceof Error ? err.message : err}`, { level: "warn" }));
  // A lot is in the API Plus pass when one of its styles is judged on sampled prices, and in the normal pass when any other style (or none) is.
  const lots = tracked.filter((l) => {
    const live = lives.get(String(l.liveWalletId));
    const sim = sims.get(String(l.liveWalletId));
    if (!live || !sim) return false;
    const styles = stylesFor(l, live);
    return apiPlusPass ? styles.some((s) => sampledStyle(s, sim)) : styles.length === 0 || styles.some((s) => !sampledStyle(s, sim));
  });
  if (apiPlusPass && lots.length === 0) return 0;
  const blacklisted = new Set((await Trader.find({ address: { $in: [...new Set(lots.map((l) => l.traderAddress))] }, status: "blacklisted" }, { address: 1 }).lean()).map((t) => t.address));

  if (!apiPlusPass) await prefetchPrices(lots.map((l) => l.mint), { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP });
  const apiPlusInterval = apiPlusPass ? await apiPlusIntervalSeconds() : 0;

  let queued = apiPlusPass
    ? 0
    : await requeueMissedFollowExits(tracked).catch((err) => {
        logEvent("trade", `[live] Couldn't re-queue missed dry-run exits: ${err instanceof Error ? err.message : err}`, { level: "warn" });
        return 0;
      });
  await Promise.all(
    lots.map(async (lot) => {
      const live = lives.get(String(lot.liveWalletId));
      const sim = sims.get(String(lot.liveWalletId));
      if (!live || !sim) return;
      const dry = lot.mode === "dry";

      // Each pass judges its own share of the lot's styles: the sampled (API Plus) ones in the API Plus pass, the rest in the normal one.
      const styles = stylesFor(lot, live).filter((style) => sampledStyle(style, sim) === apiPlusPass);

      if (blacklisted.has(lot.traderAddress)) {
        // Settles every way at once. A dry lot that has already decided every style has nothing left to settle.
        if (!dry || lotStyleIds(lot).some((id) => !lot.dryExits?.[id])) if (await queueSell(lot, "blacklisted", null, null, tradeDelaySeconds(live))) queued += 1;
        return;
      }
      if (styles.length === 0) return;

      const apiPlus = apiPlusPass && apiPlusInterval > 0;
      // Peak / lowest value and armed trailing stops are shared by the styles judged on sweep prices (or, on an api_plus wallet, all on sampled ones). The API Plus style
      // of a wallet whose simulation isn't api_plus judges on sampled prices of its own, so it keeps its own armed rules and leaves the lot's peak / lowest alone.
      const sharedState = !apiPlusPass || sim.settings?.trackingMethod === "api_plus";
      const armedField = sharedState ? "armedTrailingStopIds" : "apiPlusArmedIds";
      const openedAtSec = lot.openedAt.getTime() / 1000;
      const s = sim.settings;
      // What the lot has seen so far, kept here so that several check moments judged in one pass (an api_plus catch-up) build on each other.
      const armed = new Set((lot[armedField] || []).map(String));
      let maxValue = lot.maxValueUsd ?? 0;
      let minValue = lot.minValueUsd ?? null;
      let remaining = styles;

      /** Judges the styles still undecided on one price: `sampleAt` is the check moment of an api_plus lot (null = now). Styles that exit leave `remaining`. */
      const judgeAt = async (price, sampleAt) => {
        if (!price?.priceUsd) return;
        const value = lotValueUsd(lot, price.priceUsd);
        const cost = buyCostUsd(lot.buy);
        if (!(cost > 0)) return;
        const percent = ((value - cost) / cost) * 100;
        const ageSeconds = apiPlus ? sampleAt - openedAtSec : (Date.now() - lot.openedAt.getTime()) / 1000;

        const peak = value > maxValue ? { maxValueUsd: value } : null;
        const trough = minValue == null || value < minValue ? { minValueUsd: value } : null;
        if (sharedState && (peak || trough)) {
          await LiveLot.updateOne({ _id: lot._id }, { $set: { ...peak, ...trough } });
          maxValue = peak ? value : maxValue;
          minValue = trough ? value : minValue;
        }

        // What this sweep saw, kept with the exit (db/simulation/exitTrigger.js).
        const triggerFor = (kind, thresholdPercent, rule) =>
          buildTrigger(kind, { thresholdPercent, unrealizedPercent: percent, valueUsd: value, priceUsd: price.priceUsd, priceSource: price.source, rule });
        // Real money and no execution delay: a stop-loss / trailing stop is queued only if a fresh read agrees it is breached. (One fresh read serves every style.)
        let fresh = null;
        const freshValue = () =>
          (fresh ??= getPrice(lot.mint, { fresh: true }).then((now) => (now?.priceUsd ? lotValueUsd(lot, now.priceUsd) : null)));
        const confirmed = (trigger) => (apiPlus ? trigger : confirmExit(trigger, { totalCost: cost, valueNow: freshValue, meta: { liveWalletId: String(lot.liveWalletId), traderAddress: lot.traderAddress, mint: lot.mint } }));

        // Trailing stops arm at the same price for every style, so it is done once. A rule that arms on this sweep is first judged on the next.
        const rules = s.trailingStops || [];
        const armedBefore = new Set(armed);
        for (const rule of rules) {
          if (!armedBefore.has(String(rule._id)) && percent >= rule.armPercent) {
            await LiveLot.updateOne({ _id: lot._id }, { $addToSet: { [armedField]: String(rule._id) } });
            armed.add(String(rule._id));
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

        for (const style of [...remaining]) {
          const exit = await judge(style);
          if (exit) {
            if (await queueSell(lot, exit.reason, dry ? style.id : null, exit.trigger, tradeDelaySeconds(live))) queued += 1;
            remaining = remaining.filter((r) => r !== style); // decided (or already queued): not judged again on a later moment
          }
        }
      };

      if (!apiPlus) {
        await judgeAt(await getPrice(lot.mint, { maxAgeMs: PRICE_MAX_AGE.RISK_SWEEP }), null);
        return;
      }
      // The sweep itself runs every few seconds, but the lot is only judged at its own check moments (opened + phase + k x interval), as the backtest does -
      // every moment that has become old enough to be listed since the last pass, in order, so a slow pass or a trade list that was late never costs a moment.
      for (let n = 0; n < API_PLUS_MAX_CATCH_UP && remaining.length > 0; n++) {
        const at = nextSampleAt({ key: `${lot.mint}:${lot._id}`, startSec: openedAtSec, intervalSec: apiPlusInterval, afterSec: lot.apiPlusLastAtSec });
        if (Date.now() / 1000 < at + INDEX_LAG_SEC) return;
        const sample = await poolPriceAt(lot.mint, at);
        if (!sample) return; // not listed yet - the next pass tries this same moment again
        await LiveLot.updateOne({ _id: lot._id }, { $set: { apiPlusLastAtSec: at } });
        lot.apiPlusLastAtSec = at;
        await judgeAt({ priceUsd: sample.priceUsd, source: `api_plus_${sample.source}` }, at);
      }
    })
  );
  return queued;
}
