import { logEvent } from "../systemLog.js";

/**
 * What made an exit happen, and the re-check that keeps one bad price reading from causing it.
 *
 * A stop-loss or trailing stop fires on ONE price reading below a level. If that reading is wrong - a pricing source that
 * hiccuped for a moment - the position is sold even though the market never went there (a +735% position was once sold by a
 * +480% trailing stop that way). So before such an exit is queued, and again when it is about to fill, the position is valued
 * with a brand-new read; if that read no longer breaches the level the exit is dropped and the position stays open. The
 * sweep simply looks again a few seconds later, and if the market really did fall the next read confirms it.
 *
 * A trailing stop is dropped only when the fresh read has RECOVERED well clear of its level, not when it is merely a hair above it: a
 * single buyer can lift a price just over the level for a moment, and the next seller then pushes it through. The recovery level sits
 * TRAILING_RECOVERY_FRACTION of the way from the exit level up to the rule's arm level (exit +60%, arm +100% -> back at +80% or more
 * drops the exit; +65% still sells). The rule stays armed either way - a dropped exit changes nothing on the position, and the next
 * sweep judges it again.
 *
 * Only exits judged on a LOW price are re-checked. A take-profit, max hold time or trader sell has no such failure: a wrong
 * reading there cannot sell something that was fine, and the sale is priced fresh at the fill anyway.
 */
export const CONFIRMED_EXITS = new Set(["stop_loss", "trailing_stop"]);

/** How far a trailing stop's price must climb back from its exit level toward its arm level before the exit is dropped (0.5 = halfway). */
export const TRAILING_RECOVERY_FRACTION = 0.5;

/** The P&L a re-check must read for the exit to be dropped. A stop-loss (and an exit queued before this existed) has no band: back above its level. */
export const recoveryLevel = (trigger) => trigger.recoverPercent ?? trigger.thresholdPercent;

/** An exit on a low price still stands unless the position has recovered: at or below its level, or short of the recovery level. */
export const triggerHolds = (trigger, unrealizedPercent) => unrealizedPercent <= trigger.thresholdPercent || unrealizedPercent < recoveryLevel(trigger);

/**
 * The record kept with an exit (queue entry, then the closed position): which rule fired, at what level, and the price and
 * value the sweep saw when it did - what you need to tell afterwards why a position was sold.
 */
export function buildTrigger(kind, { thresholdPercent, unrealizedPercent, valueUsd, priceUsd, priceSource, rule }) {
  return {
    kind,
    thresholdPercent,
    sweepPercent: unrealizedPercent,
    sweepValueUsd: valueUsd,
    sweepPriceUsd: priceUsd,
    sweepPriceSource: priceSource ?? null,
    ...(rule
      ? {
          ruleId: String(rule._id),
          armPercent: rule.armPercent,
          recoverPercent: kind === "trailing_stop" && rule.armPercent > thresholdPercent ? thresholdPercent + TRAILING_RECOVERY_FRACTION * (rule.armPercent - thresholdPercent) : null,
        }
      : {}),
    at: new Date(),
  };
}

/**
 * Decision-time re-check, run by the sweep before it queues a stop-loss / trailing-stop exit.
 * @param {object} trigger from buildTrigger
 * @param {{ totalCost: number, valueNow: () => Promise<number|null>, meta: object }} options valueNow returns the position's value from a fresh read (null = unpriceable)
 * @returns {Promise<object|null>} the trigger with the confirming read added, or null when the exit should NOT happen now
 */
export async function confirmExit(trigger, { totalCost, valueNow, meta }) {
  const value = await valueNow().catch(() => null);
  if (!Number.isFinite(value) || !(totalCost > 0)) return null; // nothing to confirm with: no exit this sweep, the next one tries again
  const unrealizedPercent = (value / totalCost - 1) * 100;
  if (!triggerHolds(trigger, unrealizedPercent)) {
    logEvent(
      "trade",
      `Dropped ${trigger.kind} exit of ${meta.mint}: the sweep read ${trigger.sweepPercent.toFixed(1)}% (${trigger.sweepPriceSource ?? "unknown source"}) but a fresh read says ${unrealizedPercent.toFixed(1)}%, recovered past the ${recoveryLevel(trigger)}% level`,
      { level: "warn", meta: { ...meta, trigger, confirmPercent: unrealizedPercent } }
    );
    return null;
  }
  return { ...trigger, confirmPercent: unrealizedPercent, confirmValueUsd: value };
}
