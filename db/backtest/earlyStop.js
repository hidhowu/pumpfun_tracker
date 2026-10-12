/**
 * Early stop for backtested traders: a trader heading for a loss is dropped as soon as the numbers say so, instead of
 * working through every remaining token. Four independent rules, each off at 0 (any one that fires drops the trader):
 *
 *  - lossDays            stop when this many FULL days closed with a net loss (they need not be consecutive)
 *  - dayLossPercent      stop when one full day closed at or below -this percent (the day's combined percent, the figure
 *                        the daily breakdown shows: the sum of that day's closed trades' percent results)
 *  - negativeBalanceEvents  stop after this many buys that left the simulated wallet's cash below zero (the "negative balance
 *                        events" the address page counts); only meaningful when the profile allows a negative balance
 *  - lossAtProgressPercent  stop once this percent of the trader's tokens have been processed and the realized P&L so far
 *                        is still negative
 *
 * "Full day" = a UTC day the simulation has completely passed (positions are worked through oldest-first, see
 * `simulatedThrough`), so a day that is still filling up never counts - a rule can only fire on a figure that is final.
 */

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

/** Raised from inside the simulation when a rule fires; the runner turns it into a stopped trader. */
export class EarlyStopError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "EarlyStopError";
    this.reason = reason;
  }
}

export const EARLY_STOP_REASONS = ["loss_days", "day_loss_cap", "negative_balance", "loss_at_progress"];

/** True if any rule is on. */
export function hasEarlyStop(rules) {
  return !!rules && ((rules.lossDays ?? 0) > 0 || (rules.dayLossPercent ?? 0) > 0 || (rules.negativeBalanceEvents ?? 0) > 0 || (rules.lossAtProgressPercent ?? 0) > 0);
}

const fmtPct = (n) => `${Math.round(n * 10) / 10}%`;

/**
 * @param {{lossDays?: number, dayLossPercent?: number, lossAtProgressPercent?: number}} rules
 * @param {{closed: Array<{closedAtMs: number, pnlUsd: number, pnlPercent: number}>, cashEvents?: Array<{t: number, delta: number, order: 0|1}>, startingUsd?: number, throughMs: number, signalsDone: number, signalsTotal: number}} state
 *   `closed`: every closed position settled so far; `cashEvents`: the wallet's cash moves (a close adds proceeds, order 0; a buy subtracts cost + fee, order 1);
 *   `throughMs`: everything before this instant is simulated
 * @returns {{reason: string, message: string} | null}
 */
export function evaluateEarlyStop(rules, { closed, cashEvents = [], startingUsd = 0, throughMs, signalsDone, signalsTotal }) {
  if (!hasEarlyStop(rules)) return null;
  const lossDays = rules.lossDays ?? 0;
  const dayLossPercent = rules.dayLossPercent ?? 0;
  const negativeBalanceEvents = rules.negativeBalanceEvents ?? 0;
  const atPercent = rules.lossAtProgressPercent ?? 0;

  if (lossDays > 0 || dayLossPercent > 0) {
    const finalBefore = dayKey(throughMs); // days strictly before this one are complete
    const byDay = new Map();
    for (const c of closed) {
      const k = dayKey(c.closedAtMs);
      if (k >= finalBefore) continue;
      const d = byDay.get(k) ?? { pnl: 0, pct: 0 };
      d.pnl += c.pnlUsd || 0;
      d.pct += c.pnlPercent || 0;
      byDay.set(k, d);
    }
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let losing = 0;
    for (const [date, d] of days) {
      if (dayLossPercent > 0 && d.pct <= -dayLossPercent) {
        return { reason: "day_loss_cap", message: `Stopped early, assumed a loss trader: lost ${fmtPct(-d.pct)} on ${date} (cap ${fmtPct(dayLossPercent)} in a day)` };
      }
      if (d.pnl < 0) losing += 1;
      if (lossDays > 0 && losing >= lossDays) {
        return { reason: "loss_days", message: `Stopped early, assumed a loss trader: ${losing} losing days (limit ${lossDays}) by ${date}` };
      }
    }
  }

  if (negativeBalanceEvents > 0) {
    // Cash before `throughMs` is final (every position that opened or closed earlier belongs to a settled signal). A buy that leaves
    // the cash below zero is one event - the same count the address page shows. Closes settle before buys at the same instant.
    const events = cashEvents.filter((e) => e.t < throughMs).sort((x, y) => x.t - y.t || x.order - y.order);
    let cash = startingUsd;
    let count = 0;
    for (const e of events) {
      cash += e.delta;
      if (e.order === 1 && cash < 0) {
        count += 1;
        if (count >= negativeBalanceEvents) {
          return { reason: "negative_balance", message: `Stopped early, assumed a loss trader: the wallet went below zero ${count} times (limit ${negativeBalanceEvents}), latest on ${dayKey(e.t)}` };
        }
      }
    }
  }

  if (atPercent > 0 && signalsTotal > 0) {
    const progress = (signalsDone / signalsTotal) * 100;
    if (progress >= atPercent) {
      const pnl = closed.reduce((n, c) => n + (c.pnlUsd || 0), 0);
      if (pnl < 0) {
        return { reason: "loss_at_progress", message: `Stopped early, assumed a loss trader: still down $${Math.round(-pnl * 100) / 100} after ${fmtPct(progress)} of its tokens (limit ${fmtPct(atPercent)})` };
      }
    }
  }
  return null;
}
