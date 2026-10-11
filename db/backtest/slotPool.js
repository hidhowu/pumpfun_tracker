/**
 * Round-robin scheduler with a per-member rate limit, used for both the proxy
 * pool and the RPC pool.
 *
 * Every request first reserves a time slot (`reserve`), then sleeps until that
 * slot (`wait`). A member's slots are spaced 1000/rps apart, so no member ever
 * exceeds its rate no matter how many requests are in flight, and because the
 * member with the EARLIEST free slot is always chosen (ties broken by a
 * rotating start index), load spreads evenly: with equal rates this is plain
 * round-robin, and a faster member simply gets proportionally more requests.
 *
 * A member that was rate-limited (429) is `cool`ed down for the duration the
 * server asked for and is skipped until then - the other members keep going.
 *
 * A member that keeps getting refused (e.g. a provider answering 403 when it
 * is over its plan limit) is also `throttle`d: its speed is multiplied by a
 * factor below 1, a little at every refusal, so it settles at a rate the
 * provider accepts. Every success `recover`s the factor slowly back toward 1.
 */
const MIN_SPEED_FACTOR = 0.1;

export class SlotPool {
  constructor() {
    this.members = new Map(); // id -> { id, rps, nextAt, coolUntil, speed, data }
    this.rotate = 0;
  }

  /** Replaces the member list, keeping the pacing/cooldown state of members that persist. */
  sync(defs) {
    const next = new Map();
    for (const def of defs) {
      const prev = this.members.get(def.id);
      next.set(def.id, {
        id: def.id,
        rps: Math.max(0.05, def.rps),
        nextAt: prev?.nextAt ?? 0,
        coolUntil: prev?.coolUntil ?? 0,
        speed: prev?.speed ?? 1,
        data: def.data,
      });
    }
    this.members = next;
  }

  get size() {
    return this.members.size;
  }

  /** Reserves the earliest slot across members. `exclude` skips members that already failed this attempt. Returns null if no member is usable. */
  reserve({ exclude } = {}) {
    const list = [...this.members.values()].filter((m) => !exclude || !exclude.has(m.id));
    if (list.length === 0) return null;
    const now = Date.now();
    let best = null;
    let bestAt = Infinity;
    for (let i = 0; i < list.length; i++) {
      const m = list[(this.rotate + i) % list.length];
      const at = Math.max(now, m.nextAt, m.coolUntil);
      if (at < bestAt) {
        best = m;
        bestAt = at;
      }
    }
    this.rotate = (this.rotate + 1) % Math.max(1, list.length);
    best.nextAt = bestAt + 1000 / (best.rps * best.speed);
    return { member: best, waitMs: Math.max(0, bestAt - now) };
  }

  /** Slows one member down by `by` (0-1) - never below 10% of its configured rate. */
  throttle(id, by = 0.75) {
    const m = this.members.get(id);
    if (m) m.speed = Math.max(MIN_SPEED_FACTOR, m.speed * by);
  }

  /** A success: creep the member's speed back toward its configured rate. */
  recover(id) {
    const m = this.members.get(id);
    if (m && m.speed < 1) m.speed = Math.min(1, m.speed * 1.04);
  }

  cool(id, ms) {
    const m = this.members.get(id);
    if (!m) return;
    m.coolUntil = Math.max(m.coolUntil, Date.now() + ms);
    m.nextAt = Math.max(m.nextAt, m.coolUntil);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
