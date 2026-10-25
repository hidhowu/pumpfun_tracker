/**
 * The exit "styles" a live wallet can judge its positions by - the sets of rules that decide when a position is sold:
 *
 *   own       the profile's stop-loss / take-profit / max hold / trailing stops, judged against what the live position really cost.
 *   follow    the connected simulation wallet's exits are copied the moment it makes them.
 *   cd<sec>   a cool-down style (the wallet's `cooldownStyles`): like "own", except that for the first <sec> seconds after the buy only these can sell it -
 *             a deep stop-loss of its own (`stopLossPercent`, 50 = -50%), a take-profit, the max hold time and the POSITIVE trailing stops (exit
 *             level above 0%). Negative trailing stops (exit level below 0%) do not fire in that time (they still arm). A loss short of that stop is sat
 *             through; once the cool-down is over the profile's normal rules apply at once, so a position that is then below an armed trailing level
 *             sells, and one that dipped under it and climbed back does not.
 *
 * "follow" copies the simulation's exits. A trade the simulation never took has none to copy, so it is judged like "own" (db/live/trading/risk.js).
 *
 * A dry run works every style out side by side on the same entries, so they can be compared; a live wallet follows the one it is set to (`exitMode`).
 */

export const cooldownId = (seconds) => `cd${seconds}`;
export const isCooldownId = (id) => /^cd\d+$/.test(String(id));

export const COOLDOWN_MIN_SECONDS = 10;
export const COOLDOWN_MAX_SECONDS = 86_400;
export const COOLDOWN_MAX_STYLES = 6;
export const COOLDOWN_DEFAULT_STOP_PERCENT = 50;

/** The wallet's cool-down styles as { id, kind, seconds, stopLossPercent }. */
export function cooldownStylesOf(live) {
  return (live.cooldownStyles ?? [])
    .filter((c) => c && Number.isFinite(c.seconds) && c.seconds > 0)
    .map((c) => ({ id: cooldownId(c.seconds), kind: "cooldown", seconds: c.seconds, stopLossPercent: Number.isFinite(c.stopLossPercent) ? c.stopLossPercent : COOLDOWN_DEFAULT_STOP_PERCENT }));
}

/** Every style id a dry lot of this wallet works out. */
export const dryStyleIds = (live) => ["own", "follow", ...cooldownStylesOf(live).map((s) => s.id)];

/** The styles a lot was opened with (lots made before cool-downs existed have only the first two). */
export const lotStyleIds = (lot) => (lot.dryStyles?.length ? lot.dryStyles : ["own", "follow"]);

/** The style a live wallet is set to, falling back to "own" when it names a cool-down style that no longer exists. */
export function selectedStyleId(live) {
  const id = live.exitMode ?? "own";
  return id === "own" || id === "follow" || cooldownStylesOf(live).some((s) => s.id === id) ? id : "own";
}

export function styleLabel(id, cooldowns = []) {
  if (id === "own") return "Its own entry";
  if (id === "follow") return "Follow simulation";
  const seconds = Number(String(id).slice(2)) || cooldowns.find((c) => c.id === id)?.seconds || 0;
  return `Cool-down ${seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`}`;
}
